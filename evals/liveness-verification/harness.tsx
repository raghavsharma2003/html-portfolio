import { createRoot } from "react-dom/client";
import LivenessCapture from "../../src/studio/LivenessCapture";
import "../../src/studio/studio.css";
import type { LivenessChallenge, LivenessState } from "../../src/studio/types";

const requestedState = new URLSearchParams(window.location.search).get("state") || "issued";
const state: LivenessState = ["issued", "uploaded", "verifying", "passed", "failed", "expired"].includes(requestedState)
  ? requestedState as LivenessState
  : "issued";
const now = Date.now();
const challenge: LivenessChallenge = {
  challenge_id: "10000000-0000-4000-8000-000000000001",
  replica_id: "20000000-0000-4000-8000-000000000002",
  phrase: "Main Raghav hoon. Today I choose my private replica. Code 482 731. I consent to Vyakti using its biometric signals only for private identity and liveness verification.",
  state,
  attempt: 2,
  source_id: state === "issued" ? null : "30000000-0000-4000-8000-000000000003",
  failure_code: state === "failed" ? "face_liveness_below_threshold" : "",
  issued_at: new Date(now).toISOString(),
  expires_at: new Date(now + 5 * 60_000).toISOString(),
  updated_at: new Date(now).toISOString(),
};

createRoot(document.getElementById("root")!).render(
  <div className="studio-shell">
    <main className="studio-main">
      <LivenessCapture
        consentActive
        challenge={challenge}
        loading={false}
        onIssue={async () => challenge}
        onCreateUpload={async () => { throw new Error("visual harness does not upload"); }}
        onRetryUpload={async () => { throw new Error("visual harness does not upload"); }}
        onFinalize={async () => challenge}
      />
    </main>
  </div>,
);
