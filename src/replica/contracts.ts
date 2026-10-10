// The consented-replica domain kernel.
//
// Pure and deliberately provider-free. Studio UI, API handlers and offline
// gates must ask these functions the same lifecycle/consent/readiness
// questions, so a button cannot claim a replica is ready while the server
// rejects it (or, worse, the reverse).

export const REPLICA_POLICY_VERSION = "replica-self-v1" as const;

export type ReplicaLifecycle =
  | "draft"
  | "consent_pending"
  | "enrolling"
  | "calibrating"
  | "ready"
  | "active"
  | "paused"
  | "revoked"
  | "purging";

export type ConsentScope =
  | "capture"
  | "transcription"
  | "biometric"
  | "training"
  | "inference"
  | "storage"
  | "sharing"
  | "api"
  | "telephony"
  | "model_improvement";

export type ConsentMethod = "account_attestation" | "live_challenge" | "manual_review";

export interface ConsentReceipt {
  id: string;
  scope: ConsentScope;
  method: ConsentMethod;
  policyVersion: string;
  receiptHash: string;
  grantedAt: number;
  expiresAt?: number | null;
  revokedAt?: number | null;
  evidenceSourceId?: string | null;
}

export type ReplicaSourceKind = "audio" | "video" | "text" | "image" | "document" | "chat_archive";

export type ReplicaSourceState =
  | "pending_upload"
  | "uploaded"
  | "quarantined"
  | "processing"
  | "ready"
  | "rejected"
  | "deleting";

export interface ReplicaSourceEvidence {
  id: string;
  kind: ReplicaSourceKind;
  captureMode: "live_challenge" | "upload" | "import" | "derived";
  state: ReplicaSourceState;
  sha256: string;
  containsThirdParties: boolean;
  consentId?: string | null;
}

export type ReplicaEvalSuite =
  | "enrollment"
  | "voice_identity"
  | "speech_quality"
  | "behaviour"
  | "memory_relationship"
  | "provenance_abuse";

export interface ReplicaEvalResult {
  suite: ReplicaEvalSuite;
  verdict: "pass" | "fail" | "inconclusive";
  corpusHash: string;
  at: number;
}

export interface ReplicaActivationInput {
  lifecycle: ReplicaLifecycle;
  subjectMode: "self";
  policyVersion: string;
  ageVerifiedAt?: number | null;
  identityVerifiedAt?: number | null;
  livenessVerifiedAt?: number | null;
  consents: readonly ConsentReceipt[];
  sources: readonly ReplicaSourceEvidence[];
  approvedGenomeVersion?: number | null;
  approvedProfileVersion?: number | null;
  readyVoiceProviders: number;
  evals: readonly ReplicaEvalResult[];
}

export const ACTIVATION_CONSENT_SCOPES: readonly ConsentScope[] = [
  "capture",
  "transcription",
  "biometric",
  "training",
  "inference",
  "storage",
] as const;

export const ACTIVATION_EVAL_SUITES: readonly ReplicaEvalSuite[] = [
  "enrollment",
  "voice_identity",
  "speech_quality",
  "behaviour",
  "memory_relationship",
  "provenance_abuse",
] as const;

export type ActivationBlocker =
  | "terminal_lifecycle"
  | "wrong_policy_version"
  | "age_unverified"
  | "identity_unverified"
  | "liveness_unverified"
  | `consent_missing:${ConsentScope}`
  | "live_challenge_missing"
  | "live_challenge_consent_missing"
  | "live_challenge_has_third_parties"
  | "voice_genome_unapproved"
  | "person_profile_unapproved"
  | "voice_provider_unready"
  | `eval_not_passed:${ReplicaEvalSuite}`;

export interface ActivationReadiness {
  ready: boolean;
  blockers: readonly ActivationBlocker[];
}

/** Active means explicitly granted, current-policy, unrevoked and unexpired. */
export function activeConsentScopes(
  receipts: readonly ConsentReceipt[],
  nowMs: number,
  policyVersion: string = REPLICA_POLICY_VERSION,
): ReadonlySet<ConsentScope> {
  const active = new Set<ConsentScope>();
  for (const r of receipts) {
    if (r.policyVersion !== policyVersion) continue;
    if (r.revokedAt != null && r.revokedAt <= nowMs) continue;
    if (r.expiresAt != null && r.expiresAt <= nowMs) continue;
    if (r.grantedAt > nowMs) continue;
    active.add(r.scope);
  }
  return active;
}

/**
 * The one activation verdict. It is intentionally stricter than "can render a
 * preview": active means the whole product claim has evidence, not merely a
 * provider voice id.
 */
export function activationReadiness(
  input: ReplicaActivationInput,
  nowMs: number,
): ActivationReadiness {
  const blockers: ActivationBlocker[] = [];

  if (input.lifecycle === "revoked" || input.lifecycle === "purging") blockers.push("terminal_lifecycle");
  if (input.policyVersion !== REPLICA_POLICY_VERSION) blockers.push("wrong_policy_version");
  if (!input.ageVerifiedAt) blockers.push("age_unverified");
  if (!input.identityVerifiedAt) blockers.push("identity_unverified");
  if (!input.livenessVerifiedAt) blockers.push("liveness_unverified");

  const consent = activeConsentScopes(input.consents, nowMs, input.policyVersion);
  for (const scope of ACTIVATION_CONSENT_SCOPES) {
    if (!consent.has(scope)) blockers.push(`consent_missing:${scope}`);
  }

  const live = input.sources.filter(
    (s) => s.kind === "audio" && s.captureMode === "live_challenge" && s.state === "ready",
  );
  if (!live.length) blockers.push("live_challenge_missing");
  if (live.some((s) => s.containsThirdParties)) blockers.push("live_challenge_has_third_parties");

  // A caller cannot relabel an arbitrary upload as a liveness recording. At
  // least one ready live source must be the evidence on an active biometric
  // receipt produced by the live-challenge verifier.
  const verifiedLiveIds = new Set(
    input.consents
      .filter(
        (r) =>
          r.scope === "biometric" &&
          r.method === "live_challenge" &&
          r.policyVersion === input.policyVersion &&
          r.grantedAt <= nowMs &&
          (r.revokedAt == null || r.revokedAt > nowMs) &&
          (r.expiresAt == null || r.expiresAt > nowMs) &&
          r.evidenceSourceId,
      )
      .map((r) => r.evidenceSourceId as string),
  );
  if (!live.some((s) => verifiedLiveIds.has(s.id))) blockers.push("live_challenge_consent_missing");

  if (!input.approvedGenomeVersion || input.approvedGenomeVersion < 1) blockers.push("voice_genome_unapproved");
  if (!input.approvedProfileVersion || input.approvedProfileVersion < 1) blockers.push("person_profile_unapproved");
  if (!Number.isInteger(input.readyVoiceProviders) || input.readyVoiceProviders < 1)
    blockers.push("voice_provider_unready");

  for (const suite of ACTIVATION_EVAL_SUITES) {
    const latest = input.evals
      .filter((e) => e.suite === suite && e.at <= nowMs)
      .sort((a, b) => b.at - a.at)[0];
    if (!latest || latest.verdict !== "pass") blockers.push(`eval_not_passed:${suite}`);
  }

  return { ready: blockers.length === 0, blockers };
}

const NEXT: Readonly<Record<ReplicaLifecycle, readonly ReplicaLifecycle[]>> = {
  draft: ["consent_pending", "revoked"],
  consent_pending: ["enrolling", "revoked"],
  enrolling: ["calibrating", "revoked"],
  calibrating: ["ready", "revoked"],
  ready: ["active", "calibrating", "revoked"],
  active: ["paused", "calibrating", "revoked"],
  paused: ["active", "calibrating", "revoked"],
  revoked: ["purging"],
  purging: [],
};

export function canTransitionReplica(
  from: ReplicaLifecycle,
  to: ReplicaLifecycle,
  readiness?: ActivationReadiness,
): boolean {
  if (!NEXT[from].includes(to)) return false;
  if ((to === "ready" || to === "active") && readiness?.ready !== true) return false;
  return true;
}

/** Server-chosen private path. UUIDs only; filenames and user input never enter it. */
export function privateSourceObjectPath(ownerUserId: string, replicaId: string, sourceId: string): string {
  const values = [ownerUserId, replicaId, sourceId];
  if (!values.every((v) => UUID_RE.test(v))) throw new Error("private source path requires UUID identifiers");
  return `${ownerUserId}/${replicaId}/${sourceId}/original`;
}

export const SYNTHETIC_AUDIO_DISCLOSURE = "This is an AI-generated voice replica." as const;

// Audit is intentionally poorer than telemetry. These keys are content or
// biometric material and must never be copied into an ordinary audit row.
const FORBIDDEN_AUDIT_KEY_RE =
  /^(audio|video|image|bytes|blob|prompt|response|text|transcript|memory|claim|embedding|voiceprint|provider_ref|url|object_path)$/i;

export function assertContentFreeAuditFacts(facts: Readonly<Record<string, unknown>>): void {
  for (const [key, value] of Object.entries(facts)) {
    if (FORBIDDEN_AUDIT_KEY_RE.test(key)) throw new Error(`replica audit cannot contain ${key}`);
    if (typeof value === "string" && value.length > 200) throw new Error(`replica audit string too long: ${key}`);
    if (value && typeof value === "object") throw new Error(`replica audit facts must be scalar: ${key}`);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
