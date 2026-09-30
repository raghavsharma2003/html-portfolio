import { createRoot } from "react-dom/client";
import CloneVerificationJourney from "../../src/studio/CloneVerificationJourney";
import "../../src/studio/design/tokens.css";
import "../../src/studio/studio.css";
import "../../src/studio/clone-verification-journey.css";
import type { ConsentReceipt, Replica, ReplicaReview, ReplicaSource } from "../../src/studio/types";

const RID = "10000000-0000-4000-8000-000000000001";
const legacySelfTest = new URLSearchParams(window.location.search).get("legacy") === "1";
const replica: Replica = {
  replica_id: RID,
  display_name: "Raghav",
  subject_mode: "self",
  lifecycle: "enrolling",
  policy_version: "replica-self-v1",
  age_verified: false,
  identity_verified: false,
  liveness_verified: false,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
};
const consent = (scope: ConsentReceipt["scope"]): ConsentReceipt => ({
  consent_id: `${scope}-receipt`,
  replica_id: RID,
  scope,
  method: "account_attestation",
  policy_version: "replica-self-v1",
  granted_at: "2026-09-01T00:00:00.000Z",
  expires_at: "2027-09-01T00:00:00.000Z",
  revoked_at: null,
});
const source: ReplicaSource = {
  source_id: "20000000-0000-4000-8000-000000000002",
  replica_id: RID,
  kind: "audio",
  capture_mode: "upload",
  mime: "audio/wav",
  byte_size: 720_044,
  state: "ready",
  contains_third_parties: false,
  voice_role: "primary",
  rejection_code: "",
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
};
const review: ReplicaReview = {
  replica_id: RID,
  self_test_mode: legacySelfTest,
  sources: [], jobs: [], attempts: [], artifacts: [], evidence: [], builds: [], voice_genomes: [],
  voice_genome_readiness: { ready: false, blockers: [], reviewed_real_evidence: 0, embedding_families: 0, voice_measurements: 0, quality_measurements: 0, speaker_segments: 0 },
};
const never = async () => { throw new Error("not used by this fixture"); };

createRoot(document.getElementById("root")!).render(
  <CloneVerificationJourney
    token="offline-owner-token"
    replica={replica}
    consents={[consent("capture"), consent("transcription"), consent("storage")]}
    sources={[source]}
    review={review}
    challenge={null}
    livenessLoading={false}
    onOpenSourcePermission={() => undefined}
    onResetLegacyClone={async () => {
      document.body.dataset.resetRequested = "true";
      return true;
    }}
    onReturnToVoice={() => undefined}
    onExit={() => undefined}
    onContinue={() => undefined}
    onCreateSourceUpload={never}
    onRetryUpload={never}
    onFinalizeSourceUpload={never}
    onDeleteSource={never}
    onSourcesChanged={async () => undefined}
    onIdentityChanged={async () => undefined}
    onIssueChallenge={never}
    onStartFaceSession={never}
    onPollFaceSession={never}
    onCancelChallenge={never}
    onCreateLivenessUpload={never}
    onFinalizeLiveness={never}
    onVerifiedConsentChanged={async () => undefined}
    onAuthError={() => undefined}
  />,
);
