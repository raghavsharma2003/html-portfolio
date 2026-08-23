import { createRoot } from "react-dom/client";
import PersonModelStudio from "../../src/studio/PersonModelStudio";
import "../../src/studio/studio.css";
import type { ClaimExtractionStatus, PersonModelStatus } from "../../src/studio/types";

const replicaId = "10000000-0000-4000-8000-000000000001";
let extracted = false;

const personModel: PersonModelStatus = {
  replica_id: replicaId,
  claims: [
    {
      claim_id: "41",
      domain: "delivery",
      key: "turn_shape",
      body: "I usually answer briefly, then leave room for the other person.",
      origin: "observed",
      confidence: 0.87,
      status: "proposed",
      sensitive: false,
      source_count: 2,
      decision: null,
      reason_code: "",
      reviewed_at: null,
      created_at: new Date().toISOString(),
    },
  ],
  readiness: {
    ready: false,
    blockers: ["self_name_required", "language_identity_required", "boundary_evidence_required"],
    conflicts: [],
    accepted_claims: 0,
  },
  profiles: [],
};

function extraction(): ClaimExtractionStatus {
  return {
    replica_id: replicaId,
    readiness: { ready: true, blockers: [], eligible_spans: 17 },
    runs: extracted ? [{
      run_id: "50000000-0000-4000-8000-000000000005",
      state: "complete",
      proposed_count: 6,
      rejected_count: 2,
      attempt: 1,
      failure_code: "",
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }] : [],
  };
}

globalThis.fetch = async (input, init) => {
  const url = String(input);
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  if (url.includes("replica-claims") && body?.op === "extract") {
    extracted = true;
    return Response.json({ run: extraction().runs[0] });
  }
  if (url.includes("replica-claims")) return Response.json({ extraction: extraction() });
  if (url.includes("replica-person-model") && init?.method === "POST") return Response.json({ decision: { decision_id: crypto.randomUUID() } });
  return Response.json({ person_model: structuredClone(personModel) });
};

createRoot(document.getElementById("root")!).render(
  <div className="studio-shell"><main className="studio-main">
    <PersonModelStudio token="offline-owner-token" replicaId={replicaId} onAuthError={() => undefined} />
  </main></div>,
);
