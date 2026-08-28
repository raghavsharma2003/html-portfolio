import { createRoot } from "react-dom/client";
import EnrollmentWorkspace from "../../src/studio/EnrollmentWorkspace";
import "../../src/studio/studio.css";
import type { ConsentReceipt } from "../../src/studio/types";

const RID = "10000000-0000-4000-8000-000000000001";
const now = "2026-08-24T00:00:00.000Z";
const consents: ConsentReceipt[] = (["capture", "transcription", "storage"] as const).map((scope, index) => ({
  consent_id: `20000000-0000-4000-8000-00000000000${index + 1}`,
  replica_id: RID,
  scope,
  method: "account_attestation",
  policy_version: "replica-self-v1",
  granted_at: now,
  expires_at: "2031-08-24T00:00:00.000Z",
  revoked_at: null,
}));

createRoot(document.getElementById("root")!).render(
  <div className="studio-shell"><main className="studio-main">
    <EnrollmentWorkspace
      replicaId={RID}
      consents={consents}
      sources={[]}
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
