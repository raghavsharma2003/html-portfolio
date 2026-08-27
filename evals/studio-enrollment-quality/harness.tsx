import { createRoot } from "react-dom/client";
import EnrollmentWorkspace from "../../src/studio/EnrollmentWorkspace";
import "../../src/studio/studio.css";
import type { ConsentReceipt, ReplicaSource } from "../../src/studio/types";

const RID = "70000000-0000-4000-8000-000000000001";
const now = "2026-08-27T00:00:00.000Z";
const consents: ConsentReceipt[] = (["capture", "transcription", "storage"] as const).map((scope, index) => ({
  consent_id: `71000000-0000-4000-8000-00000000000${index + 1}`,
  replica_id: RID,
  scope,
  method: "account_attestation",
  policy_version: "replica-self-v1",
  granted_at: now,
  expires_at: "2031-08-27T00:00:00.000Z",
  revoked_at: null,
}));

const sources: ReplicaSource[] = [
  { source_id: "english-ready", replica_id: RID, kind: "audio", capture_mode: "upload", mime: "audio/wav", byte_size: 18_000_000, state: "ready", contains_third_parties: false, rejection_code: "", created_at: now, updated_at: now },
  { source_id: "hindi-processing", replica_id: RID, kind: "audio", capture_mode: "upload", mime: "audio/wav", byte_size: 24_000_000, state: "processing", contains_third_parties: false, rejection_code: "", created_at: now, updated_at: now },
  { source_id: "unlabeled-ready", replica_id: RID, kind: "video", capture_mode: "import", mime: "video/mp4", byte_size: 42_000_000, state: "ready", contains_third_parties: false, rejection_code: "", created_at: now, updated_at: now },
];

window.localStorage.setItem(`vyakti:enrollment-languages:${RID}`, JSON.stringify({
  "english-ready": "english",
  "hindi-processing": "hindi",
}));

createRoot(document.getElementById("root")!).render(
  <div className="studio-shell"><main className="studio-main">
    <EnrollmentWorkspace
      replicaId={RID}
      consents={consents}
      sources={sources}
      loading={false}
      onGrantConsent={async () => undefined}
      onRevokeConsent={async () => undefined}
      onCreateUpload={async () => { throw new Error("offline visual harness"); }}
      onRetryUpload={async () => { throw new Error("offline visual harness"); }}
      onFinalizeUpload={async () => { throw new Error("offline visual harness"); }}
      onDeleteSource={async () => "pending"}
    />
  </main></div>,
);
