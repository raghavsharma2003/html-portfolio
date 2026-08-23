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
