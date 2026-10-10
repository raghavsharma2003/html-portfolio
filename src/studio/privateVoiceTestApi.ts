import { ReplicaApiError } from "./replicaApi";

export type PrivateVoiceRunState =
  | "queued"
  | "claimed"
  | "running"
  | "ready"
  | "failed"
  | "unknown"
  | "revoked"
  | "expired";

export type PrivateVoiceRatingKey =
  | "owner_likeness"
  | "naturalness"
  | "indian_accent"
  | "pronunciation";

export type PrivateVoiceRatings = Record<PrivateVoiceRatingKey, number>;

export interface PrivateVoiceCandidate {
  source_id: string;
  artifact_id: string;
  reference_sha256: string;
  duration_ms: number;
  snapshot_hash: string;
}

export interface PrivateVoiceConfig {
  version: "private-hindi-sample/v1" | "private-hindi-text/v1";
  scope: "private_voice_test";
  text: string;
  text_sha256: string;
  language_id: "hi";
  model_arm: "hindi_v3";
  model_commitment: string;
  seed: number;
  style: {
    exaggeration: number;
    cfgWeight: number;
    temperature: number;
  };
  conditioning: {
    referenceLanguageMode: string;
    referenceLanguageEvidenceScope: string;
    textLanguageMode: string;
    requestedCfgWeight: number;
    effectiveCfgWeight: number;
    qualityState: string;
    qualityWarnings: string[];
  };
  text_frontend?: Record<string, unknown>;
  text_provenance: "server_fixed_sample" | "owner_entered_private_sample";
  reference_language_provenance: "unassessed";
  identity_scope: "account_self_attestation";
  identity_claim_allowed: false;
  release_eligible: false;
  training_allowed: false;
}

export interface PrivateVoiceMetrics {
  [key: string]: unknown;
}

export interface PrivateVoiceRun {
  run_id: string;
  state: PrivateVoiceRunState;
  source_id: string;
  artifact_id: string;
  scope: "private_voice_test";
  identity_scope: "account_self_attestation";
  release_eligible: false;
  identity_claim_allowed: false;
  config: PrivateVoiceConfig;
  created_at: string;
  expires_at: string;
  error_code: string | null;
  cleanup_pending: boolean;
  metrics: PrivateVoiceMetrics | null;
  ratings: PrivateVoiceRatings | null;
  audio_available: boolean;
}

export interface PrivateVoiceAvailability {
  resume_run_id?: string | null;
  enabled: true;
  scope: "private_voice_test";
  statement_set: "private-own-voice/v1";
  statement: string;
  config: PrivateVoiceConfig;
  text_limits: {
    max_code_points: number;
    language_id: "hi";
    english_supported: false;
  } | null;
  candidates: PrivateVoiceCandidate[];
  run?: PrivateVoiceRun | null;
}

export interface PrivateVoiceGenerateResult {
  created: boolean;
  run: PrivateVoiceRun;
}

const RUN_STATES = new Set<PrivateVoiceRunState>([
  "queued", "claimed", "running", "ready", "failed", "unknown", "revoked", "expired",
]);

export class PrivateVoiceApiError extends ReplicaApiError {
  code: string;

  constructor(code: string, status: number, data?: unknown) {
    super(code.replaceAll("_", " "), status, data);
    this.code = code;
  }
}

function queryPath(values: Record<string, string>): string {
  return `/api/private-voice?${new URLSearchParams(values)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validRun(value: unknown): value is PrivateVoiceRun {
  if (!isObject(value)) return false;
  return typeof value.run_id === "string"
    && value.run_id.length > 0
    && typeof value.state === "string"
    && RUN_STATES.has(value.state as PrivateVoiceRunState);
}

function validateAvailability(value: unknown): PrivateVoiceAvailability {
  if (!isObject(value) || value.enabled !== true || value.scope !== "private_voice_test"
      || value.statement_set !== "private-own-voice/v1" || typeof value.statement !== "string"
      || !isObject(value.config) || !Array.isArray(value.candidates)) {
    throw new PrivateVoiceApiError("private_voice_response_invalid", 502, value);
  }
  const textLimits = value.text_limits === undefined ? null : value.text_limits;
  const textLimitMax = isObject(textLimits) ? Number(textLimits.max_code_points) : Number.NaN;
  if (textLimits !== null && (!isObject(textLimits) || typeof textLimits.max_code_points !== "number" || !Number.isInteger(textLimitMax)
      || textLimitMax < 1 || textLimitMax > 280 || textLimits.language_id !== "hi" || textLimits.english_supported !== false)) {
    throw new PrivateVoiceApiError("private_voice_response_invalid", 502, value);
  }
  for (const item of value.candidates) {
    if (!isObject(item) || typeof item.source_id !== "string" || typeof item.artifact_id !== "string"
        || typeof item.reference_sha256 !== "string" || typeof item.duration_ms !== "number"
        || typeof item.snapshot_hash !== "string") {
      throw new PrivateVoiceApiError("private_voice_response_invalid", 502, value);
    }
  }
  if (value.resume_run_id != null && (typeof value.resume_run_id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value.resume_run_id))) throw new PrivateVoiceApiError("private_voice_response_invalid", 502, value);
  if (value.run != null && !validRun(value.run)) {
    throw new PrivateVoiceApiError("private_voice_response_invalid", 502, value);
  }
  return { ...value, text_limits: textLimits } as unknown as PrivateVoiceAvailability;
}

function validateRunResult(value: unknown): { run: PrivateVoiceRun } {
  if (!isObject(value) || !validRun(value.run)) {
    throw new PrivateVoiceApiError("private_voice_response_invalid", 502, value);
  }
  return value as unknown as { run: PrivateVoiceRun };
}

async function jsonRequest(path: string, token: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: init.signal || AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = isObject(data) && typeof data.error === "string"
      ? data.error
      : "private_voice_operation_failed";
    throw new PrivateVoiceApiError(code, response.status, data);
  }
  return data;
}

export async function readPrivateVoice(
  token: string,
  replicaId: string,
  signal?: AbortSignal,
): Promise<PrivateVoiceAvailability> {
  return validateAvailability(await jsonRequest(queryPath({ replica_id: replicaId }), token, { signal }));
}

export async function readPrivateVoiceRun(
  token: string,
  replicaId: string,
  runId: string,
  signal?: AbortSignal,
): Promise<PrivateVoiceRun> {
  const result = validateRunResult(await jsonRequest(queryPath({
    action: "status",
    replica_id: replicaId,
    run_id: runId,
  }), token, { signal }));
  return result.run;
}

export async function generatePrivateVoice(
  token: string,
  replicaId: string,
  candidate: PrivateVoiceCandidate,
  runId: string,
  statementSet: PrivateVoiceAvailability["statement_set"],
  text: string | undefined,
  signal?: AbortSignal,
): Promise<PrivateVoiceGenerateResult> {
  const value = await jsonRequest("/api/private-voice", token, {
    method: "POST",
    signal,
    body: JSON.stringify({
      action: "generate",
      replica_id: replicaId,
      source_id: candidate.source_id,
      artifact_id: candidate.artifact_id,
      run_id: runId,
      expected_snapshot_hash: candidate.snapshot_hash,
      statement_set: statementSet,
      attestations: { own_voice_private_use: true },
      ...(text === undefined ? {} : { text }),
    }),
  });
  if (!isObject(value) || typeof value.created !== "boolean" || !validRun(value.run)) {
    throw new PrivateVoiceApiError("private_voice_response_invalid", 502, value);
  }
  return value as unknown as PrivateVoiceGenerateResult;
}

export async function ratePrivateVoice(
  token: string,
  replicaId: string,
  runId: string,
  ratings: PrivateVoiceRatings,
  signal?: AbortSignal,
): Promise<PrivateVoiceRun> {
  const result = validateRunResult(await jsonRequest("/api/private-voice", token, {
    method: "POST",
    signal,
    body: JSON.stringify({ action: "rate", replica_id: replicaId, run_id: runId, ratings }),
  }));
  return result.run;
}

export async function revokePrivateVoice(
  token: string,
  replicaId: string,
  runId: string,
  signal?: AbortSignal,
): Promise<PrivateVoiceRun> {
  const result = validateRunResult(await jsonRequest("/api/private-voice", token, {
    method: "POST",
    signal,
    body: JSON.stringify({ action: "revoke", replica_id: replicaId, run_id: runId }),
  }));
  return result.run;
}

export async function fetchPrivateVoiceAudio(
  token: string,
  replicaId: string,
  runId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetch(queryPath({ action: "audio", replica_id: replicaId, run_id: runId }), {
    headers: { Authorization: `Bearer ${token}` },
    signal: signal || AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const code = isObject(data) && typeof data.error === "string" ? data.error : "private_voice_audio_unavailable";
    throw new PrivateVoiceApiError(code, response.status, data);
  }
  if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "audio/wav") {
    throw new PrivateVoiceApiError("private_voice_audio_invalid", 502);
  }
  return response.blob();
}
