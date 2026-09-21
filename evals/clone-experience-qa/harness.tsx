import { createRoot } from "react-dom/client";
import { useState } from "react";
import "@fontsource-variable/geist";
import "@fontsource-variable/instrument-sans";
import "@fontsource/noto-sans-devanagari/devanagari-600.css";
import CloneExperience from "../../src/studio/CloneExperience";
import "../../src/studio/design/tokens.css";
import "../../src/studio/studio.css";
import "../../src/studio/design/honesty.css";
import "../../src/studio/design/mobile.css";
import "../../src/studio/clone-experience.css";
import "../../src/studio/voice-field.css";
import "../../src/studio/vyakti-mark.css";
import "../../src/studio/clone-verification-journey.css";
import type { ActivityView } from "../../src/studio/activityApi";
import type {
  ConsentReceipt, LivenessChallenge, Replica, ReplicaReview, ReplicaSource,
  SignedUpload, VoiceBuildIntent,
} from "../../src/studio/types";
import type { WizardInput } from "../../src/studio/wizardModel";

type Scenario = "replacement-old-draft" | "candidate-ready" | "missing-receipt" | "finalized-replay" | "rooms" | "recorder";
type QaCounters = {
  createCalls: number;
  retryCalls: number;
  finalizeCalls: number;
  xhrSends: number;
  buildCalls: number;
  buildCandidate: string;
  uploadIntent: string;
  languageHint: string;
};

declare global { interface Window { __cloneQa: QaCounters } }

window.addEventListener("error", (event) => {
  document.documentElement.dataset.qaRuntimeError = event.error instanceof Error
    ? event.error.stack || event.error.message
    : event.message;
});
window.addEventListener("unhandledrejection", (event) => {
  document.documentElement.dataset.qaRuntimeError = event.reason instanceof Error
    ? event.reason.stack || event.reason.message
    : String(event.reason);
});

function exposeCounter(name: keyof QaCounters, value: number | string) {
  window.__cloneQa[name] = value as never;
  document.documentElement.dataset[`qa${name[0].toUpperCase()}${name.slice(1)}`] = String(value);
}

const replicaId = "10000000-0000-4000-8000-000000000001";
const oldSourceId = "20000000-0000-4000-8000-000000000002";
const candidateSourceId = "30000000-0000-4000-8000-000000000003";
const uploadIntentId = "40000000-0000-4000-8000-000000000004";
const buildIntentId = "50000000-0000-4000-8000-000000000005";
const sagaKey = `vyakti:experience:voice-saga:v1:${replicaId}`;
const scenario = (new URLSearchParams(location.search).get("scenario") || "replacement-old-draft") as Scenario;

const replica: Replica = {
  replica_id: replicaId, display_name: "Me", subject_mode: "self", lifecycle: "enrolling",
  policy_version: "replica-self-v1", age_verified: false, identity_verified: false, liveness_verified: false,
  created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z",
};
const receipt = (scope: ConsentReceipt["scope"]): ConsentReceipt => ({
  consent_id: `${scope}-receipt`, replica_id: replicaId, scope, method: "account_attestation",
  policy_version: replica.policy_version, granted_at: "2026-09-01T00:00:00.000Z",
  expires_at: "2027-09-01T00:00:00.000Z", revoked_at: null,
});
const consents = [receipt("capture"), receipt("transcription"), receipt("storage")];
const oldPrimary: ReplicaSource = {
  source_id: oldSourceId, replica_id: replicaId, kind: "audio", capture_mode: "upload", mime: "audio/wav",
  byte_size: 720_044, state: "ready", contains_third_parties: false, voice_role: "primary", rejection_code: "",
  created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z",
};
const candidate = (state: ReplicaSource["state"]): ReplicaSource => ({
  ...oldPrimary, source_id: candidateSourceId, voice_role: "supporting", state,
  upload_intent_id: uploadIntentId, created_at: "2026-09-02T00:00:00.000Z", updated_at: "2026-09-02T00:00:00.000Z",
});
const review: ReplicaReview = {
  replica_id: replicaId, self_test_mode: false, sources: [], jobs: [], attempts: [], artifacts: [], evidence: [], builds: [],
  voice_genomes: [{
    version: 1, status: "draft", source_set_hash: "1".repeat(64), manifest_hash: "2".repeat(64),
    builder_version: "qa", embedding_families: 1, target_segments: 1, enrollment_artifacts: 1,
    source_ids: [oldSourceId], references: [], created_at: "2026-09-01T00:05:00.000Z",
  }],
  voice_genome_readiness: { ready: true, blockers: [], reviewed_real_evidence: 1, embedding_families: 1, voice_measurements: 1, quality_measurements: 1, speaker_segments: 1 },
};
const wizardInput: WizardInput = {
  stopped: false, sourceConsent: true, sourceCount: 2, contextItemCount: 0,
  identityVerified: false, livenessVerified: false, sheetPersisted: false, mode: "generic",
  runtime: null, connectedChannels: null, platformWork: null,
};
const emptyActivity: ActivityView = {
  replica_id: replicaId, generated_at: "2026-09-02T00:00:00.000Z", jobs: [], lanes: [], in_flight: false, next_poll_ms: null,
};

window.__cloneQa = { createCalls: 0, retryCalls: 0, finalizeCalls: 0, xhrSends: 0, buildCalls: 0, buildCandidate: "", uploadIntent: "", languageHint: "" };
for (const [name, value] of Object.entries(window.__cloneQa)) exposeCounter(name as keyof QaCounters, value);
sessionStorage.removeItem("vyakti:experience:reveal");
localStorage.removeItem(sagaKey);
if (scenario === "replacement-old-draft" || scenario === "candidate-ready" || scenario === "missing-receipt") {
  localStorage.setItem(sagaKey, JSON.stringify({
    uploadIntentId, buildIntentId,
    sourceId: scenario === "missing-receipt" ? null : candidateSourceId,
    language: "hinglish",
  }));
}

const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
  if (url.pathname === "/api/replica-activity") return new Response(JSON.stringify(emptyActivity), { status: 200, headers: { "content-type": "application/json" } });
  if (url.origin === location.origin) return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
  return nativeFetch(input, init);
};

class CountingUploadRequest {
  method = ""; url = ""; status = 201;
  upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
  onload: ((event: ProgressEvent) => void) | null = null;
  onerror: ((event: ProgressEvent) => void) | null = null;
  onabort: ((event: ProgressEvent) => void) | null = null;
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader() { /* no network in this fixture */ }
  getResponseHeader() { return null; }
  abort() { this.onabort?.(new ProgressEvent("abort")); }
  send() { exposeCounter("xhrSends", window.__cloneQa.xhrSends + 1); this.onload?.(new ProgressEvent("load")); }
}
window.XMLHttpRequest = CountingUploadRequest as unknown as typeof XMLHttpRequest;

// The visual harness uses the browser's real media metadata and decoding.

function queuedIntent(sourceId: string): VoiceBuildIntent {
  return {
    intent_id: buildIntentId, replica_id: replicaId, candidate_source_id: sourceId, state: "queued",
    build_id: null, build_state: null, target_version: 2, blockers: [], last_error_code: "", promoted_at: null,
    next_check_at: "2026-09-02T00:00:10.000Z", created_at: "2026-09-02T00:00:00.000Z", updated_at: "2026-09-02T00:00:00.000Z",
  };
}

// oxlint-disable-next-line react/only-export-components
function Harness() {
  const initial = scenario === "replacement-old-draft" ? [oldPrimary, candidate("processing")]
    : scenario === "candidate-ready" ? [oldPrimary, candidate("ready")]
      : scenario === "missing-receipt" || scenario === "rooms" ? [oldPrimary] : [];
  const [sources, setSources] = useState<ReplicaSource[]>(initial);

  async function createUpload(input: { uploadIntentId?: string; languageHint?: "en" | "hi" | "hi-latn" }) {
    exposeCounter("createCalls", window.__cloneQa.createCalls + 1);
    exposeCounter("uploadIntent", input.uploadIntentId || "");
    exposeCounter("languageHint", input.languageHint || "");
    if (new URLSearchParams(location.search).has("uploadHold")) await new Promise(() => {});
    if (new URLSearchParams(location.search).has("uploadFail")) throw new Error("The upload could not connect. Your recording is still here.");
    const created = candidate("ready");
    setSources([created]);
    return { source: created, upload: null as SignedUpload | null, replayed: true, finalized: true };
  }
  async function requestBuild(input: { candidateSourceId: string; buildIntentId: string }) {
    exposeCounter("buildCalls", window.__cloneQa.buildCalls + 1);
    exposeCounter("buildCandidate", input.candidateSourceId);
    return queuedIntent(input.candidateSourceId);
  }
  const neverChallenge = async (): Promise<LivenessChallenge> => { throw new Error("not used by this fixture"); };

  return <CloneExperience
    identity="owner@example.test" accessToken="offline" replicas={[replica]} selected={replica}
    creatingNew={false} creating={false} revoking={false} consents={consents} sources={sources}
    runtimeStatus={null} activityView={emptyActivity} wizardInput={wizardInput} review={review}
    reviewLoading={false} challenge={null} livenessLoading={false} notice="" error={null}
    onDismissNotice={() => undefined} onDismissError={() => undefined} onSignOut={() => undefined}
    onBeginClone={async () => replica} onGrantConsent={async () => undefined}
    onSelectReplica={async () => undefined} onStartNew={() => undefined} onRevoke={async () => undefined}
    onCreateUpload={createUpload as never}
    onRetryUpload={async () => { exposeCounter("retryCalls", window.__cloneQa.retryCalls + 1); return { source: candidate("ready"), upload: null, replayed: true, finalized: true }; }}
    onFinalizeUpload={async () => { exposeCounter("finalizeCalls", window.__cloneQa.finalizeCalls + 1); return candidate("ready"); }}
    onRequestVoiceBuild={requestBuild} onDeleteSource={async () => "complete"}
    onRefreshEnrollment={async () => undefined} onRefreshReview={async () => undefined}
    onIssueChallenge={neverChallenge as never} onStartFaceSession={neverChallenge as never}
    onPollFaceSession={neverChallenge as never} onCancelChallenge={neverChallenge as never}
    onCreateLivenessUpload={neverChallenge as never} onFinalizeLiveness={neverChallenge as never}
    onVerifiedConsentChanged={async () => undefined} onActivityView={() => undefined}
    onActivityAct={() => undefined} onAuthError={() => undefined} onContextCount={() => undefined}
  />;
}

createRoot(document.getElementById("root")!).render(<Harness />);
