import { createRoot } from "react-dom/client";
import VoiceEnrollmentLab from "../../src/studio/VoiceEnrollmentLab";
import "../../src/studio/studio.css";
import type { ConsentReceipt, ProviderConsent, Replica, VoiceProfile } from "../../src/studio/types";

const replica: Replica = {
  replica_id: "10000000-0000-4000-8000-000000000001",
  display_name: "Raghav",
  subject_mode: "self",
  lifecycle: "calibrating",
  policy_version: "replica-self-v1",
  age_verified: true,
  identity_verified: true,
  liveness_verified: true,
  created_at: "2026-08-24T00:00:00.000Z",
  updated_at: "2026-08-24T00:00:00.000Z",
};
const consents: ConsentReceipt[] = ["capture", "storage", "biometric", "training"].map((scope, index) => ({
  consent_id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  replica_id: replica.replica_id,
  scope: scope as ConsentReceipt["scope"],
  method: scope === "capture" || scope === "storage" ? "account_attestation" : "manual_review",
  policy_version: replica.policy_version,
  granted_at: "2026-08-24T00:00:00.000Z",
  expires_at: "2027-08-24T00:00:00.000Z",
  revoked_at: null,
}));
const providerConsent: ProviderConsent = {
  provider_consent_id: "30000000-0000-4000-8000-000000000003",
  replica_id: replica.replica_id,
  provider: "azure_personal_voice",
  policy_version: "azure-personal-voice/2026-01-01",
  template_version: "microsoft-personal-voice-consent/en-US/v1",
  locale: "en-US",
  statement_sha256: "a".repeat(64),
  state: "accepted",
  attempt: 1,
  source_id: "40000000-0000-4000-8000-000000000004",
  failure_code: "",
  issued_at: "2026-08-24T00:00:00.000Z",
  expires_at: "2026-08-24T00:10:00.000Z",
  uploaded_at: "2026-08-24T00:05:00.000Z",
  accepted_at: "2026-08-24T00:06:00.000Z",
  updated_at: "2026-08-24T00:05:00.000Z",
};
const ready: VoiceProfile = {
  voice_profile_id: "50000000-0000-4000-8000-000000000005",
  replica_id: replica.replica_id,
  genome_version: 3,
  status: "ready",
  capabilities: { streaming: true, synthesis: true },
  created_at: "2026-08-24T00:06:00.000Z",
  updated_at: "2026-08-24T00:06:00.000Z",
};

globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.includes("replica-provider-consent")) return Response.json({ provider_consent: providerConsent });
  if (url.includes("replica-voice")) return Response.json({ voice_profile: ready });
  return Response.json({});
};

createRoot(document.getElementById("root")!).render(
  <div className="studio-shell"><main className="studio-main">
    <VoiceEnrollmentLab token="offline-owner-token" replica={replica} consents={consents} onAuthError={() => undefined} />
  </main></div>,
);
