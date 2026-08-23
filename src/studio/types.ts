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

export interface Replica {
  replica_id: string;
  display_name: string;
  subject_mode: "self";
  lifecycle: ReplicaLifecycle;
  policy_version: string;
  age_verified: boolean;
  identity_verified: boolean;
  liveness_verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface StudioSession {
  userId: string;
  email?: string;
  phone?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export type ConsentScope = "capture" | "transcription" | "storage";

export interface ConsentReceipt {
  consent_id: string;
  replica_id: string;
  scope: ConsentScope;
  method: "account_attestation" | "live_challenge" | "manual_review";
  policy_version: string;
  granted_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

export type SourceKind = "audio" | "video" | "image" | "text" | "document" | "chat_archive";
export type SourceState =
  | "pending_upload"
  | "uploaded"
  | "quarantined"
  | "processing"
  | "ready"
  | "rejected"
  | "deleting";

export interface ReplicaSource {
  source_id: string;
  replica_id: string;
  kind: SourceKind;
  capture_mode: "live_challenge" | "upload" | "import" | "derived";
  mime: string;
  byte_size: number;
  state: SourceState;
  contains_third_parties: boolean;
  rejection_code: string;
  created_at: string;
  updated_at: string;
}

export interface SignedUpload {
  method: "PUT";
  url: string;
  headers: Record<string, string>;
  expires_at: string;
}

export type LivenessState = "issued" | "uploaded" | "verifying" | "passed" | "failed" | "expired";

export interface LivenessChallenge {
  challenge_id: string;
  replica_id: string;
  phrase: string;
  state: LivenessState;
  attempt: number;
  source_id: string | null;
  failure_code: string;
  issued_at: string;
  expires_at: string;
  updated_at: string;
}

export type EvidenceDecision = "accepted" | "rejected" | "superseded";

export interface ReviewProvenance { family: string; name: string; version: string }
export interface ReviewEvidence {
  evidence_id: string;
  source_id: string;
  artifact_id: string | null;
  evidence_type: string;
  reviewable: boolean;
  span_start_ms: number | null;
  span_end_ms: number | null;
  confidence: number | null;
  provenance: ReviewProvenance;
  summary: Record<string, string | number | boolean>;
  decision: EvidenceDecision | null;
  reason_code: string;
  reviewed_at: string | null;
  created_at: string;
}

export interface ReplicaReview {
  replica_id: string;
  sources: Array<Pick<ReplicaSource, "source_id" | "kind" | "capture_mode" | "mime" | "byte_size" | "state" | "contains_third_parties" | "rejection_code" | "created_at" | "updated_at"> & { duration_ms: number | null }>;
  jobs: Array<{ job_id: string; source_id: string; step: string; revision: number; state: string; attempt: number; failure_code: string; next_attempt_at: string; created_at: string; updated_at: string }>;
  attempts: Array<{ job_id: string; attempt: number; outcome: string; provenance: ReviewProvenance; failure_code: string; facts: Record<string, string | number | boolean>; started_at: string; finished_at: string | null }>;
  artifacts: Array<{ artifact_id: string; source_id: string; parent_artifact_id: string | null; created_by_job_id: string | null; stage: string; variant_key: string; mime: string; byte_size: number; duration_ms: number | null; transform: { name: string; version: string }; provenance: ReviewProvenance; created_at: string }>;
  evidence: ReviewEvidence[];
  builds: Array<{ build_id: string; build_kind: string; target_version: number; builder_version: string; state: string; attempt: number; failure_code: string; created_at: string; updated_at: string }>;
  voice_genome_readiness: { ready: boolean; blockers: string[]; reviewed_real_evidence: number; embedding_families: number; voice_measurements: number; quality_measurements: number; speaker_segments: number };
}

export interface ReplicaRuntimeStatus {
  replica_id: string;
  lifecycle: ReplicaLifecycle;
  active: boolean;
  can_activate: boolean;
  blockers: string[];
  qualification: { passed: number; required: number };
  versions: { profile: number | null; voice_genome: number | null };
  activated_at: string | null;
}

export interface ReplicaClaim {
  claim_id: string;
  domain: string;
  key: string;
  body: string;
  origin: "self_declared" | "observed" | "imported" | "inferred";
  confidence: number;
  status: "proposed" | "approved" | "rejected" | "superseded";
  sensitive: boolean;
  source_count: number;
  decision: "accepted" | "rejected" | "superseded" | null;
  reason_code: string;
  reviewed_at: string | null;
  created_at: string;
}

export interface ReplicaProfileSummary {
  replica_id: string;
  version: number;
  status: "draft" | "approved" | "retired";
  created_at: string;
}

export interface PersonModelStatus {
  replica_id: string;
  claims: ReplicaClaim[];
  readiness: { ready: boolean; blockers: string[]; conflicts: string[]; accepted_claims: number };
  profiles: ReplicaProfileSummary[];
}
