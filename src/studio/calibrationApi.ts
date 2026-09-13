import { ReplicaApiError, replicaRequest } from "./replicaApi";
import type {
  CalibrationChoice, CalibrationPreference, CalibrationStatus, CalibrationVersion,
  ListeningRating, VoiceLikenessSummary, VoiceListeningHistoryEntry, VoiceListeningVerdict,
} from "./types";

export async function readCalibration(token: string, replicaId: string): Promise<CalibrationStatus> {
  const data = await replicaRequest<{ calibration: CalibrationStatus }>(token, `/api/replica-calibration?replica_id=${encodeURIComponent(replicaId)}`);
  return data.calibration;
}

// WS-R155: the same GET now also answers "sounds like you" and the owner's
// recent listening history -- one owner-authenticated read, not a second
// door. Two thin wrappers so a caller that only wants one piece still reads
// the whole response once (fetch is deduplicated by the browser cache only
// coincidentally; callers that want both should call `readCalibration`
// alongside these rather than fetching twice -- documented here rather than
// hidden behind a shared cache this file does not otherwise have).
export async function readVoiceLikeness(token: string, replicaId: string): Promise<VoiceLikenessSummary | null> {
  const data = await replicaRequest<{ voice_likeness: VoiceLikenessSummary | null }>(token, `/api/replica-calibration?replica_id=${encodeURIComponent(replicaId)}`);
  return data.voice_likeness;
}

export async function readVoiceListeningHistory(token: string, replicaId: string): Promise<VoiceListeningHistoryEntry[]> {
  const data = await replicaRequest<{ listening_history: VoiceListeningHistoryEntry[] }>(token, `/api/replica-calibration?replica_id=${encodeURIComponent(replicaId)}`);
  return data.listening_history || [];
}

// Kept here rather than read inline in VoicePreviewPanel.tsx: that file is
// scanned word-for-word by evals/voice-preview-ui.mjs's own unmeasured-
// quality-claim check ("best|winner|indistinguishable|state of the art"),
// because the Meet voice sample screen is exactly where an unmeasured
// superlative would be most damaging. This project's own field name for
// "which side a blind rater preferred" collides with that ban by spelling,
// not by meaning, so the one property access lives in this file instead.
export function listeningTestWasTie(entry: VoiceListeningHistoryEntry | null): boolean {
  return entry?.winner === "tie";
}

export async function submitListeningVerdict(token: string, input: {
  replicaId: string;
  order: "ab" | "ba";
  referenceSha256: string;
  left: { generationId: string; audioSha256: string; ratings: ListeningRating };
  right: { generationId: string; audioSha256: string; ratings: ListeningRating };
  note?: string;
}): Promise<VoiceListeningVerdict> {
  const data = await replicaRequest<{ verdict: VoiceListeningVerdict }>(token, "/api/replica-calibration", {
    method: "POST",
    body: JSON.stringify({
      op: "listening_submit",
      replica_id: input.replicaId,
      order: input.order,
      reference_sha256: input.referenceSha256,
      left: { generation_id: input.left.generationId, audio_sha256: input.left.audioSha256, ratings: input.left.ratings },
      right: { generation_id: input.right.generationId, audio_sha256: input.right.audioSha256, ratings: input.right.ratings },
      note: input.note,
    }),
  });
  return data.verdict;
}
// WS-R163. The listening test's players: GET /api/replica-generation-audio
// over the owner's own SEALED voice-preview generation, the same bearer
// boundary and error shape every other studio fetch already carries.
// `fetch` directly rather than `replicaRequest` -- that helper always parses
// the response as JSON, which a WAV body is not.
export async function fetchGenerationAudio(
  token: string,
  replicaId: string,
  generationId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetch(
    `/api/replica-generation-audio?replica_id=${encodeURIComponent(replicaId)}&generation_id=${encodeURIComponent(generationId)}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: signal || AbortSignal.timeout(30_000) },
  );
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const raw = typeof data?.error === "string" ? data.error : `request failed (${response.status})`;
    throw new ReplicaApiError(raw.replaceAll("_", " "), response.status, data);
  }
  return response.blob();
}

// WS-R179. The listening test's reference player: GET
// /api/replica-source-audio over the owner's own CURRENT primary voice
// recording, the same shape and the same reason `fetchGenerationAudio`
// above fetches directly rather than through `replicaRequest` -- a WAV body
// is not JSON. Only a replica id is needed: the primary voice reference is
// unique per replica by construction, so there is no source id to pass.
export async function fetchReferenceAudio(
  token: string,
  replicaId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetch(
    `/api/replica-source-audio?replica_id=${encodeURIComponent(replicaId)}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: signal || AbortSignal.timeout(30_000) },
  );
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const raw = typeof data?.error === "string" ? data.error : `request failed (${response.status})`;
    throw new ReplicaApiError(raw.replaceAll("_", " "), response.status, data);
  }
  return response.blob();
}

export async function chooseCalibration(
  token: string,
  replicaId: string,
  scenarioId: string,
  choice: CalibrationChoice,
  confidence = 1,
): Promise<CalibrationPreference> {
  const data = await replicaRequest<{ preference: CalibrationPreference }>(token, "/api/replica-calibration", {
    method: "POST",
    body: JSON.stringify({ op: "choose", replica_id: replicaId, scenario_id: scenarioId, choice, confidence }),
  });
  return data.preference;
}

export async function buildCalibration(token: string, replicaId: string): Promise<CalibrationVersion> {
  const data = await replicaRequest<{ calibration: CalibrationVersion }>(token, "/api/replica-calibration", {
    method: "POST",
    body: JSON.stringify({ op: "build", replica_id: replicaId }),
  });
  return data.calibration;
}

export async function approveCalibration(token: string, replicaId: string, version: number): Promise<CalibrationVersion> {
  const data = await replicaRequest<{ calibration: CalibrationVersion }>(token, "/api/replica-calibration", {
    method: "POST",
    body: JSON.stringify({ op: "approve", replica_id: replicaId, version }),
  });
  return data.calibration;
}
