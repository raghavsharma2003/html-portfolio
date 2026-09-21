import { ReplicaApiError } from "./replicaApi";

export type InternalVoiceRunState = "queued" | "running" | "ready" | "failed" | "unknown" | "revoked";
export type InternalVoiceRatingKey = "owner_likeness" | "naturalness" | "indian_accent" | "pronunciation";
export type InternalVoiceRatings = Record<InternalVoiceRatingKey, number>;

export interface InternalVoiceRun {
  run_id: string;
  state: InternalVoiceRunState;
  text: string;
  language_id: "hi";
  playback_url: string | null;
  reference_url: string;
  ratings: InternalVoiceRatings | null;
  metrics: {
    total_ms: number;
    model_elapsed_ms: number;
    duration_ms: number;
    real_time_factor: number;
    first_audible_ms: number | null;
  } | null;
  error_code: string | null;
  cleanup_pending: boolean;
}

export interface InternalVoiceStatus {
  enabled: true;
  scope: "internal_owner_voice";
  reference: { label: string; duration_ms: number | null; available: boolean };
  run: InternalVoiceRun | null;
  can_generate: boolean;
}

const RUN_STATES = new Set<InternalVoiceRunState>(["queued", "running", "ready", "failed", "unknown", "revoked"]);

export class InternalVoiceApiError extends ReplicaApiError {
  code: string;

  constructor(code: string, status: number, data?: unknown) {
    super(code.replaceAll("_", " "), status, data);
    this.code = code;
  }
}

function statusPath(replicaId: string, runId?: string): string {
  const query = new URLSearchParams({ replica_id: replicaId });
  if (runId) query.set("run_id", runId);
  return `/api/internal-voice?${query}`;
}

function validateStatus(value: unknown): InternalVoiceStatus {
  const status = value as Partial<InternalVoiceStatus> | null;
  const run = status?.run as Partial<InternalVoiceRun> | null | undefined;
  if (status?.enabled !== true || status.scope !== "internal_owner_voice" || !status.reference
      || typeof status.reference.available !== "boolean" || typeof status.can_generate !== "boolean"
      || (run && (typeof run.run_id !== "string" || !RUN_STATES.has(run.state as InternalVoiceRunState)))) {
    throw new InternalVoiceApiError("internal_voice_response_invalid", 502, value);
  }
  return status as InternalVoiceStatus;
}

async function requestStatus(token: string, path: string, init?: RequestInit): Promise<InternalVoiceStatus> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    signal: init?.signal || AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = typeof data?.error === "string" ? data.error : "internal_voice_operation_failed";
    throw new InternalVoiceApiError(code, response.status, data);
  }
  return validateStatus(data);
}

export function readInternalVoice(token: string, replicaId: string, runId?: string, signal?: AbortSignal) {
  return requestStatus(token, statusPath(replicaId, runId), { signal });
}

export function generateInternalVoice(token: string, replicaId: string, runId: string) {
  return requestStatus(token, "/api/internal-voice", {
    method: "POST",
    body: JSON.stringify({ action: "generate", replica_id: replicaId, run_id: runId }),
  });
}

export function rateInternalVoice(token: string, replicaId: string, runId: string, ratings: InternalVoiceRatings) {
  return requestStatus(token, "/api/internal-voice", {
    method: "POST",
    body: JSON.stringify({ action: "rate", replica_id: replicaId, run_id: runId, ratings }),
  });
}

export function revokeInternalVoice(token: string, replicaId: string, runId: string) {
  return requestStatus(token, "/api/internal-voice", {
    method: "POST",
    body: JSON.stringify({ action: "revoke", replica_id: replicaId, run_id: runId }),
  });
}

export async function fetchInternalVoiceAudio(
  token: string,
  replicaId: string,
  runId: string,
  kind: "audio" | "reference",
  signal?: AbortSignal,
): Promise<Blob> {
  const query = new URLSearchParams({ action: kind, replica_id: replicaId, run_id: runId });
  const response = await fetch(`/api/internal-voice?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: signal || AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const code = typeof data?.error === "string" ? data.error : "internal_voice_audio_unavailable";
    throw new InternalVoiceApiError(code, response.status, data);
  }
  if (response.headers.get("content-type")?.split(";", 1)[0] !== "audio/wav") {
    throw new InternalVoiceApiError("internal_voice_audio_invalid", 502);
  }
  return response.blob();
}
