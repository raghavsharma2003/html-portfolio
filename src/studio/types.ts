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

export interface ReplicaErasureStatus {
  state: "pending" | "complete";
  requested_at: string;
  updated_at: string;
  completed_at: string | null;
  backup_expires_at: string | null;
  attempts: number;
  provider: "pending" | "confirmed";
  storage: "pending" | "confirmed";
  deleted_classes: string[];
}

export interface StudioSession {
  userId: string;
  email?: string;
  phone?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export type ConsentScope = "capture" | "transcription" | "storage" | "biometric" | "training" | "inference";

export interface ConsentReceipt {
  consent_id: string;
  replica_id: string;
  scope: ConsentScope;
  method: "account_attestation" | "live_challenge" | "manual_review";
  policy_version: string;
  granted_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  receipt_hash?: string;
  statement_set?: string | null;
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
  capture_mode: "live_challenge" | "provider_consent" | "identity_document" | "upload" | "import" | "derived";
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
  resumable?: {
    protocol: "tus-1.0";
    endpoint: string;
    headers: Record<string, string>;
    metadata: Record<string, string>;
    chunk_size: number;
  };
  expires_at: string;
}

export type LivenessState = "issued" | "uploaded" | "verifying" | "passed" | "failed" | "expired";
export type FaceSessionState =
  | "not_started" | "issuing" | "ready" | "polling"
  | "passed_deleting" | "failed_deleting" | "expired_deleting"
  | "passed_deleted" | "failed_deleted" | "expired_deleted";

export interface LivenessChallenge {
  challenge_id: string;
  replica_id: string;
  phrase: string;
  state: LivenessState;
  attempt: number;
  source_id: string | null;
  failure_code: string;
  face_session_state: FaceSessionState;
  face_session_expires_at: string | null;
  issued_at: string;
  expires_at: string;
  updated_at: string;
}

export type IdentityCaseState = "submitted" | "verifying" | "evidence_ready" | "verified" | "expired" | "failed" | "revoked";

export interface IdentityCase {
  identity_case_id: string;
  replica_id: string;
  source_id: string | null;
  state: IdentityCaseState;
  attempt: number;
  adult_evidence: boolean;
  document_authentic: boolean;
  document_current: boolean;
  face_reference_ready: boolean;
  credential_expires_at: string | null;
  failure_code: string;
  consented_at: string;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ProviderConsentState = "issued" | "uploaded" | "accepted" | "revoked" | "expired" | "failed";

export interface ProviderConsent {
  provider_consent_id: string;
  replica_id: string;
  provider: "azure_personal_voice";
  policy_version: string;
  template_version: string;
  locale: "en-US";
  statement_sha256: string;
  statement?: string;
  state: ProviderConsentState;
  attempt: number;
  source_id: string | null;
  failure_code: string;
  issued_at: string;
  expires_at: string;
  uploaded_at: string | null;
  accepted_at: string | null;
  updated_at: string;
}

export interface VoiceProfile {
  voice_profile_id: string;
  replica_id: string;
  genome_version: number;
  status: "creating" | "ready" | "failed" | "deleting";
  capabilities: Record<string, string | number | boolean>;
  created_at: string;
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
  /** true only when REPLICA_SELF_TEST_MODE granted this replica's identity
   * checks and review decisions automatically (self-only, default off). See
   * blockerClass.ts's `disabledReason("us", ...)` for how the studio must
   * say so on screen -- never silently. */
  self_test_mode: boolean;
  sources: Array<Pick<ReplicaSource, "source_id" | "kind" | "capture_mode" | "mime" | "byte_size" | "state" | "contains_third_parties" | "rejection_code" | "created_at" | "updated_at"> & { duration_ms: number | null }>;
  jobs: Array<{ job_id: string; source_id: string; step: string; revision: number; state: string; attempt: number; failure_code: string; next_attempt_at: string; created_at: string; updated_at: string }>;
  attempts: Array<{ job_id: string; attempt: number; outcome: string; provenance: ReviewProvenance; failure_code: string; facts: Record<string, string | number | boolean>; started_at: string; finished_at: string | null }>;
  artifacts: Array<{ artifact_id: string; source_id: string; parent_artifact_id: string | null; created_by_job_id: string | null; stage: string; variant_key: string; mime: string; byte_size: number; duration_ms: number | null; transform: { name: string; version: string }; provenance: ReviewProvenance; selection_decision: "selected" | "rejected" | "superseded" | null; selection_reason: string; selection_reviewed_at: string | null; created_at: string }>;
  evidence: ReviewEvidence[];
  builds: Array<{ build_id: string; build_kind: string; target_version: number; builder_version: string; state: string; attempt: number; failure_code: string; created_at: string; updated_at: string }>;
  voice_genomes: Array<{ version: number; status: "draft" | "approved" | "retired"; source_set_hash: string; manifest_hash: string; builder_version: string; embedding_families: number; target_segments: number; enrollment_artifacts: number; created_at: string }>;
  voice_genome_readiness: { ready: boolean; blockers: string[]; reviewed_real_evidence: number; embedding_families: number; voice_measurements: number; quality_measurements: number; speaker_segments: number };
}

export interface ReplicaRuntimeStatus {
  replica_id: string;
  lifecycle: ReplicaLifecycle;
  active: boolean;
  can_activate: boolean;
  blockers: string[];
  qualification: { passed: number; required: number };
  /** `voice_genome` is the newest genome that EXISTS, any status (WS-AP: a
   *  production run measured this reading 0 while a real draft genome sat in
   *  the database, because it used to be scoped to `status='approved'`).
   *  `voice_genome_status` says which status that version is in. `optional`
   *  because `activateOwnedRuntime`'s own response, taken right after a
   *  successful activation, has no draft/approved ambiguity to report. */
  versions: { profile: number | null; calibration: number | null; voice_genome: number | null };
  voice_genome_status?: string | null;
  activated_at: string | null;
}

export type CalibrationChoice = "left" | "right" | "tie" | "neither";

export interface CalibrationPreference {
  preference_id: string;
  scenario_id: string;
  scenario_revision: number;
  layer: "delivery" | "language" | "behaviour" | "memory" | "relationship";
  choice: CalibrationChoice;
  confidence: number;
  revision: number;
  created_at: string;
}

export interface CalibrationScenario {
  scenario_id: string;
  revision: number;
  layer: CalibrationPreference["layer"];
  axis: string;
  context: string;
  left: { id: string; label: string; description: string };
  right: { id: string; label: string; description: string };
  preference: CalibrationPreference | null;
}

export interface CalibrationVersion {
  replica_id: string;
  version: number;
  profile_version: number;
  status: "draft" | "approved" | "retired";
  created_at: string;
}

export interface CalibrationStatus {
  replica_id: string;
  profile_version: number | null;
  scenarios: CalibrationScenario[];
  readiness: { ready: boolean; blockers: string[]; reviewed: number; resolved: number; required: number; covered_layers: string[] };
  versions: CalibrationVersion[];
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

export interface ClaimExtractionRun {
  run_id: string;
  state: "extracting" | "complete" | "failed" | "superseded";
  proposed_count: number;
  rejected_count: number;
  attempt: number;
  failure_code: string;
  created_at: string;
  completed_at: string | null;
}

export interface ClaimExtractionStatus {
  replica_id: string;
  readiness: { ready: boolean; blockers: string[]; eligible_spans: number };
  runs: ClaimExtractionRun[];
}

export interface ReplicaDialogueDelivery {
  mode: "grounded" | "warm" | "playful" | "direct" | "repair";
  pace: "slow" | "natural" | "brisk";
  intensity: number;
  language_hint: string;
  nonverbals: Array<"breath" | "soft_laugh" | "pause" | "sigh">;
}

export interface ReplicaDialogueTurn {
  turn_id: string;
  session_id: string;
  reply: string;
  delivery: ReplicaDialogueDelivery;
  can_voice: boolean;
  billing_state?: "settled" | "not_metered" | "reconcile_required";
  created_at: string;
}

export type TurnFeedbackRating = "exact" | "close" | "off" | "unsafe";

export interface ReplicaTurnFeedback {
  feedback_id: string;
  turn_id: string;
  revision: number;
  ratings: Record<string, TurnFeedbackRating>;
  reason_codes: string[];
  has_correction: boolean;
  voice_generation_bound: boolean;
  created_at: string;
}

export type CandidateEvalDimension = "overall" | "wording" | "behavior" | "relationship" | "memory" | "delivery";
export type CandidateEvalChoice = "a" | "b" | "tie";

export interface CandidateEvalAssignment {
  assignment_id: string;
  assignment_hash: string;
  sequence: number;
  context: string;
  option_a: string;
  option_b: string;
}

export interface CandidateEvaluation {
  available: boolean;
  replica_id: string;
  state?: "collecting" | "complete";
  progress?: { completed: number; total: number };
  dimensions?: CandidateEvalDimension[];
  assignment?: CandidateEvalAssignment | null;
}
