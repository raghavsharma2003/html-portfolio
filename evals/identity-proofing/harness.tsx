import { createRoot } from "react-dom/client";
import IdentityProofing from "../../src/studio/IdentityProofing";
import "../../src/studio/studio.css";
import type { IdentityCase, IdentityCaseState, ReplicaSource } from "../../src/studio/types";

const RID = "10000000-0000-4000-8000-000000000001";
const SOURCE = "20000000-0000-4000-8000-000000000002";
const requested = new URLSearchParams(window.location.search).get("state") || "none";
const state = ["submitted", "verifying", "evidence_ready", "verified", "expired", "failed", "revoked"].includes(requested)
  ? requested as IdentityCaseState
  : null;
const source: ReplicaSource = {
  source_id: SOURCE,
  replica_id: RID,
  kind: "image",
  capture_mode: "identity_document",
  mime: "image/jpeg",
  byte_size: 1_248_000,
  state: "quarantined",
  contains_third_parties: false,
  rejection_code: "",
  created_at: "2026-08-24T00:00:00.000Z",
  updated_at: "2026-08-24T00:00:00.000Z",
};
const identityCase: IdentityCase | null = state ? {
  identity_case_id: "30000000-0000-4000-8000-000000000003",
  replica_id: RID,
  source_id: SOURCE,
  state,
  attempt: 1,
  adult_evidence: state === "evidence_ready" || state === "verified",
  document_authentic: state === "evidence_ready" || state === "verified",
  document_current: state === "evidence_ready" || state === "verified",
  face_reference_ready: state === "evidence_ready" || state === "verified",
  credential_expires_at: state === "evidence_ready" || state === "verified" ? "2031-08-24T00:00:00.000Z" : null,
  failure_code: state === "failed" ? "identity_document_authenticity_failed" : "",
  consented_at: "2026-08-24T00:00:00.000Z",
  verified_at: state === "evidence_ready" || state === "verified" ? "2026-08-24T00:02:00.000Z" : null,
  created_at: "2026-08-24T00:00:00.000Z",
  updated_at: "2026-08-24T00:02:00.000Z",
} : null;

globalThis.fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body || "{}"));
  if (body.op === "submit") return Response.json({ identity_case: { ...identityCase, state: "submitted" } });
  return Response.json({ identity_case: identityCase });
};

createRoot(document.getElementById("root")!).render(
  <div className="studio-shell"><main className="studio-main">
    <IdentityProofing
      token="offline-owner-token"
      replicaId={RID}
      sources={[source]}
      onChanged={async () => undefined}
      onAuthError={() => undefined}
    />
  </main></div>,
);
