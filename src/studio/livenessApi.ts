import { replicaRequest } from "./replicaApi";
import type { LivenessChallenge, ReplicaSource, SignedUpload } from "./types";

export type BiometricVerificationAttestations = {
  live_face_and_voice_processing: true;
  compare_face_to_my_id: true;
  anti_spoof_and_synthetic_detection: true;
  erase_raw_and_provider_session: true;
  self_only_private_replica: true;
};

export type SelectedReferenceComparison = {
  statement_set: "selected-voice-comparison/v1";
  primary_source_id: string;
  primary_selection_id: string;
  source_sha256: string;
  comparison_snapshot_sha256: string;
  source_label: null;
  source_created_at: string;
  locales: ["en-IN", "hi-IN"];
  available: true;
  code: "";
};

export type SelectedReferenceAttestations = {
  selected_reference_is_my_voice: true;
  compare_this_capture_to_selected_reference: true;
  comparison_is_private_verification_only: true;
};

export type LivenessIssueInput = {
  locale: "en-IN" | "hi-IN";
  expected_primary_source_id: string;
  expected_primary_selection_id: string;
  expected_primary_source_sha256: string;
  expected_comparison_snapshot_sha256: string;
  attestations: BiometricVerificationAttestations;
  comparison_attestations: SelectedReferenceAttestations;
};

const BIOMETRIC_KEYS = ["live_face_and_voice_processing", "compare_face_to_my_id", "anti_spoof_and_synthetic_detection", "erase_raw_and_provider_session", "self_only_private_replica"] as const;
const COMPARISON_KEYS = ["selected_reference_is_my_voice", "compare_this_capture_to_selected_reference", "comparison_is_private_verification_only"] as const;
const SHA256 = /^[0-9a-f]{64}$/;
const validUuid = (value: unknown): value is string => typeof value === "string" && value.length === 36 && UUID.test(value);
const validHash = (value: unknown): value is string => typeof value === "string" && value.length === 64 && SHA256.test(value);
const invalidComparison = () => new Error("The selected recording could not be checked. Try again.");

function validComparison(value: unknown): value is SelectedReferenceComparison {
  if (!value || typeof value !== "object") return false;
  const c = value as SelectedReferenceComparison;
  return c.statement_set === "selected-voice-comparison/v1" && validUuid(c.primary_source_id) &&
    validUuid(c.primary_selection_id) && validHash(c.source_sha256) && validHash(c.comparison_snapshot_sha256) &&
    c.source_label === null && typeof c.source_created_at === "string" && Number.isFinite(Date.parse(c.source_created_at)) &&
    Array.isArray(c.locales) && c.locales.length === 2 && c.locales[0] === "en-IN" && c.locales[1] === "hi-IN" &&
    c.available === true && c.code === "";
}

const DEVICE_KEY = "meera.device.v1";
export type LivenessCaptureReadiness = {
  challenge: LivenessChallenge | null;
  readiness: { ready: boolean; waiting_on: "us" | null; code: string };
  comparison?: SelectedReferenceComparison | null;
  comparison_code?: "" | "selected_reference_not_available";
};

export async function livenessCaptureReadiness(token: string, replicaId: string, signal?: AbortSignal) {
  const data = await replicaRequest<LivenessCaptureReadiness>(token, "/api/replica-liveness", {
    method: "POST",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : undefined,
    body: JSON.stringify({ op: "capture_readiness", replica_id: replicaId }),
  });
  if (typeof data?.readiness?.ready !== "boolean" || typeof data.readiness.code !== "string" ||
      data.readiness.waiting_on !== (data.readiness.ready ? null : "us") ||
      (data.challenge && data.challenge.replica_id !== replicaId)) throw invalidComparison();
  if (data.comparison != null && (!validComparison(data.comparison) || data.comparison_code !== "")) throw invalidComparison();
  if (data.readiness.ready && !validComparison(data.comparison)) throw invalidComparison();
  if (data.comparison == null && data.comparison_code !== undefined && data.comparison_code !== "selected_reference_not_available") throw invalidComparison();
  return data;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stableFaceDeviceId() {
  try {
    const existing = localStorage.getItem(DEVICE_KEY) || "";
    if (UUID.test(existing)) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

export async function livenessStatus(token: string, replicaId: string) {
  const data = await replicaRequest<{ challenge: LivenessChallenge | null }>(token, "/api/replica-liveness", {
    method: "POST",
    body: JSON.stringify({ op: "status", replica_id: replicaId }),
  });
  return data.challenge;
}

export async function issueLivenessChallenge(
  token: string,
  replicaId: string,
  input: LivenessIssueInput,
  signal?: AbortSignal,
) {
  if (!validUuid(replicaId) || !validUuid(input.expected_primary_source_id) || !validUuid(input.expected_primary_selection_id) ||
      !validHash(input.expected_primary_source_sha256) || !validHash(input.expected_comparison_snapshot_sha256) ||
      !["en-IN", "hi-IN"].includes(input.locale) ||
      BIOMETRIC_KEYS.some(key => input.attestations?.[key] !== true) ||
      COMPARISON_KEYS.some(key => input.comparison_attestations?.[key] !== true)) throw invalidComparison();
  const data = await replicaRequest<{ challenge: LivenessChallenge }>(token, "/api/replica-liveness", {
    method: "POST",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : undefined,
    body: JSON.stringify({ op: "issue", replica_id: replicaId, locale: input.locale,
      expected_primary_source_id: input.expected_primary_source_id,
      expected_primary_selection_id: input.expected_primary_selection_id,
      expected_primary_source_sha256: input.expected_primary_source_sha256,
      expected_comparison_snapshot_sha256: input.expected_comparison_snapshot_sha256,
      attestations: Object.fromEntries(BIOMETRIC_KEYS.map(key => [key, input.attestations[key]])),
      comparison_attestations: Object.fromEntries(COMPARISON_KEYS.map(key => [key, input.comparison_attestations[key]])),
    }),
  });
  if (!data.challenge || data.challenge.replica_id !== replicaId || !validUuid(data.challenge.challenge_id)) throw invalidComparison();
  return data.challenge;
}

export async function cancelLivenessChallenge(token: string, replicaId: string, challengeId: string) {
  const data = await replicaRequest<{
    challenge: LivenessChallenge;
    erasure: "pending" | "confirmed" | "not_required";
  }>(token, "/api/replica-liveness", {
    method: "POST",
    body: JSON.stringify({ op: "cancel", replica_id: replicaId, challenge_id: challengeId }),
  });
  return data;
}

export async function startOfficialFaceSession(token: string, replicaId: string, challengeId: string) {
  return replicaRequest<{ challenge: LivenessChallenge; quick_link_url: string }>(token, "/api/replica-liveness", {
    method: "POST",
    signal: AbortSignal.timeout(210_000),
    body: JSON.stringify({
      op: "start_face",
      replica_id: replicaId,
      challenge_id: challengeId,
      device_id: stableFaceDeviceId(),
    }),
  });
}

export async function pollOfficialFaceSession(token: string, replicaId: string, challengeId: string) {
  const data = await replicaRequest<{ challenge: LivenessChallenge }>(token, "/api/replica-liveness", {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({ op: "poll_face", replica_id: replicaId, challenge_id: challengeId }),
  });
  return data.challenge;
}

export async function createLivenessUpload(
  token: string,
  input: {
    replicaId: string;
    challengeId: string;
    kind: "audio" | "video";
    mime: string;
    byteSize: number;
    sha256: string;
  },
) {
  return replicaRequest<{
    challenge: LivenessChallenge;
    source: ReplicaSource;
    upload: SignedUpload;
  }>(token, "/api/replica-liveness", {
    method: "POST",
    body: JSON.stringify({
      op: "create_upload",
      replica_id: input.replicaId,
      challenge_id: input.challengeId,
      kind: input.kind,
      mime: input.mime,
      byte_size: input.byteSize,
      sha256: input.sha256,
      contains_third_parties: false,
    }),
  });
}

export async function finalizeLivenessUpload(
  token: string,
  replicaId: string,
  challengeId: string,
  sourceId: string,
) {
  return replicaRequest<{
    challenge: LivenessChallenge;
    source: ReplicaSource;
    verification: "pending";
  }>(token, "/api/replica-liveness", {
    method: "POST",
    body: JSON.stringify({
      op: "finalize",
      replica_id: replicaId,
      challenge_id: challengeId,
      source_id: sourceId,
    }),
  });
}
