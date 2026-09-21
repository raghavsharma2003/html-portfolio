import { createRoot } from "react-dom/client";
import { useState } from "react";
import CloneExperience from "../../src/studio/CloneExperience";
import { StudioLocaleProvider } from "../../src/studio/localeContext";
import { DEMO_TEACHER } from "../../src/engine/agents/characters/demoTeacher";
import type { TeacherSheet } from "../../src/engine/agents/teacherTypes";
import type { ActivityView } from "../../src/studio/activityApi";
import type { ConsentReceipt, Replica, ReplicaReview, ReplicaSource } from "../../src/studio/types";
import type { WizardInput } from "../../src/studio/wizardModel";
import "../../src/studio/design/tokens.css";
import "../../src/studio/studio.css";
import "../../src/studio/clone-experience.css";

const params = new URLSearchParams(location.search);
const ridA = "10000000-0000-4000-8000-000000000001";
const ridB = "10000000-0000-4000-8000-000000000002";
const sourceId = "20000000-0000-4000-8000-000000000001";
const textItemId = "30000000-0000-4000-8000-000000000001";
const textSourceId = "40000000-0000-4000-8000-000000000001";
const personSheet: TeacherSheet = {
  ...DEMO_TEACHER,
  sheetKind: "person", slug: "person-fixture", name: "Priya Menon", version: "person-fixture-draft",
  identityWho: "a product designer", identityLife: "works and plays badminton", lifeTexture: "keeps detailed notes",
  tasteTopics: "cricket and old films", curiosityTopics: "how cities work", personLine: "Product designer and badminton regular.",
  personValues: ["curiosity"], personNeverSay: ["share private details"],
  personTalk: { register: "mixed", scriptBaseline: "roman-hinglish", codeSwitchNote: "Hindi when excited" },
  subjectStrands: [], examTrack: [], doubtEscalationLadder: [], rigorFloor: [], boardVerbalisms: [], commonMistakeBank: [], analogyBank: [],
  syllabusScope: "", outOfScopePolicy: "", technicalTermRule: "", explanationOrder: "", workedExamplePattern: "", firstMoveOnDoubt: "",
  notationConventions: "", credentialFacts: "", boundaryParagraph: "", stageEarly: "", stageGettingClose: "", stageEstablished: "",
  ritualPatternShapes: "", abilityLabelBan: "", winMethodRule: "", academicIntegrityStance: "", voiceCloneId: null,
  life: { ...DEMO_TEACHER.life, weekdayShape: [], weekendShape: [], weeklyRhythm: [], preoccupations: [] },
};
const replica = (id: string): Replica => ({
  replica_id: id, display_name: id === ridA ? "Priya" : "Asha", subject_mode: "self", lifecycle: "enrolling",
  policy_version: "replica-self-v1", age_verified: false, identity_verified: false, liveness_verified: false,
  created_at: "2026-09-14T00:00:00.000Z", updated_at: "2026-09-14T00:00:00.000Z",
});
const source = (id: string): ReplicaSource => ({
  source_id: sourceId, replica_id: id, kind: "audio", capture_mode: "upload", mime: "audio/wav", byte_size: 624044,
  state: "ready", contains_third_parties: false, voice_role: "primary", rejection_code: "", upload_intent_id: "50000000-0000-4000-8000-000000000001",
  created_at: "2026-09-14T00:00:00.000Z", updated_at: "2026-09-14T00:02:00.000Z",
});
const consent = (id: string, scope: ConsentReceipt["scope"]): ConsentReceipt => ({
  consent_id: `${scope}-${id}`, replica_id: id, scope, method: "account_attestation", policy_version: "replica-self-v1",
  granted_at: "2026-09-14T00:00:00.000Z", expires_at: "2027-09-14T00:00:00.000Z", revoked_at: null,
});
const review = (id: string): ReplicaReview => ({
  replica_id: id, self_test_mode: false, sources: [], jobs: [], attempts: [], artifacts: [], evidence: [], builds: [], voice_genomes: [],
  voice_genome_readiness: { ready: false, blockers: ["identity_verification_required"], reviewed_real_evidence: 0, embedding_families: 0, voice_measurements: 0, quality_measurements: 0, speaker_segments: 0 },
});
const activity = (id: string): ActivityView => ({ replica_id: id, generated_at: "2026-09-14T00:02:00.000Z", jobs: [], lanes: [], in_flight: false, next_poll_ms: null });
const hasText = params.get("text") !== "0";
const preSaved = params.get("saved") !== "0";

declare global { interface Window { privateMeetProbe: { sheet: Record<string, boolean>; selected: string; hasText: boolean; switchReplica: () => void } } }

window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
  const method = init?.method || "GET";
  if (url.pathname === "/api/internal-voice") return new Response(JSON.stringify({ enabled: false }), { status: 404, headers: { "content-type": "application/json" } });
  if (url.pathname === "/api/context-items") return Response.json({
    items: hasText ? [{ item_id: textItemId, source_id: textSourceId, kind: "file", format: "text", source_name: "My notes.txt", source_url: "", byte_size: 240, extracted_chars: 220, extractor: "text", status: "mined", refusal_reason: "", routed_to: "", mine_skip_reason: "", authorship: "mine", owner_speaker: "", consent_scope: "own_context", proposal: "present", created_at: "2026-09-14T00:00:00.000Z", updated_at: "2026-09-14T00:00:00.000Z" }] : [],
    count: hasText ? 1 : 0, quota: { items: hasText ? 1 : 0, bytes: hasText ? 240 : 0, max_items: 200, max_bytes: 524288000 },
    limits: { max_item_bytes: 20971520, accepted_file_formats: ["txt", "md", "pdf", "docx"], routed_elsewhere: {} },
  });
  if (url.pathname === "/api/teacher-sheet") {
    if (method === "POST") {
      if (params.get("delay") === "1") await new Promise(resolve => setTimeout(resolve, 250));
      const body = JSON.parse(String(init?.body || "{}"));
      return Response.json({ sheet: { draft: body.draft, sheet_id: "60000000-0000-4000-8000-000000000001", status: "draft", updated_at: new Date().toISOString() } });
    }
    if (url.searchParams.get("op") === "publication_review") return Response.json({ sheet: null, review: null, blockers: [] });
    return Response.json({ sheet: { draft: personSheet, sheet_id: "60000000-0000-4000-8000-000000000001", status: "draft", updated_at: "2026-09-14T00:00:00.000Z" } });
  }
  if (url.pathname === "/api/replica-text-rehearsal") return Response.json({ readiness: { can_ask: false, selected: null, drafts: [], context_items: [] } });
  if (url.pathname === "/api/replica-activity") return Response.json(activity(ridA));
  return Response.json({});
};

function Harness() {
  const [selectedId, setSelectedId] = useState(ridA);
  const [sheets, setSheets] = useState<Record<string, boolean>>({ [ridA]: preSaved, [ridB]: false });
  const selected = replica(selectedId);
  window.privateMeetProbe = { sheet: sheets, selected: selectedId, hasText, switchReplica: () => setSelectedId(id => id === ridA ? ridB : ridA) };
  localStorage.setItem(`vyakti:experience:voice-saga:v1:${selectedId}`, JSON.stringify({
    uploadIntentId: "50000000-0000-4000-8000-000000000001", buildIntentId: "70000000-0000-4000-8000-000000000001", sourceId, language: "english",
  }));
  const wizard: WizardInput = { stopped: false, sourceConsent: true, sourceCount: 1, contextItemCount: hasText ? 1 : 0,
    identityVerified: false, livenessVerified: false, sheetPersisted: Boolean(sheets[selectedId]), mode: "generic", runtime: null, connectedChannels: null, platformWork: null };
  const never = async (): Promise<never> => { throw new Error("unused fixture action"); };
  return <StudioLocaleProvider locale="en" setLocale={() => {}}><button id="fixture-switch" type="button" onClick={() => window.privateMeetProbe.switchReplica()}>Switch fixture replica</button><CloneExperience
    accountScope={`owner:${selectedId}`} ownerUserId="80000000-0000-4000-8000-000000000001" identity="owner@example.test" accessToken={`token:${selectedId}`}
    replicas={[replica(ridA), replica(ridB)]} selected={selected} creatingNew={false} creating={false} revoking={false}
    consents={[consent(selectedId, "capture"), consent(selectedId, "transcription"), consent(selectedId, "storage")]} sources={[source(selectedId)]}
    runtimeStatus={null} activityView={activity(selectedId)} wizardInput={wizard} review={review(selectedId)} reviewLoading={false} challenge={null} livenessLoading={false}
    notice="" error={null} onDismissNotice={() => {}} onDismissError={() => {}} onSignOut={() => {}} onBeginClone={async () => selected} onGrantConsent={async () => {}}
    onSelectReplica={async id => setSelectedId(id)} onStartNew={() => {}} onRevoke={async () => false} onCreateUpload={never} onRetryUpload={never} onFinalizeUpload={never}
    onRequestVoiceBuild={async () => ({ intent_id: "70000000-0000-4000-8000-000000000001", replica_id: selectedId, candidate_source_id: sourceId, state: "waiting", build_id: null, build_state: null, target_version: null, blockers: ["candidate_source_processing"], last_error_code: "", promoted_at: null, next_check_at: "2026-09-14T00:03:00.000Z", created_at: "2026-09-14T00:00:00.000Z", updated_at: "2026-09-14T00:00:00.000Z" })}
    onDeleteSource={async () => "complete"} onRefreshEnrollment={async () => {}} onRefreshReview={async () => {}} onCheckCaptureReadiness={never}
    onIssueChallenge={never} onStartFaceSession={never} onPollFaceSession={never} onCancelChallenge={never} onCreateLivenessUpload={never} onFinalizeLiveness={never}
    onVerifiedConsentChanged={async () => {}} onActivityView={() => {}} onActivityAct={() => {}} onAuthError={() => {}} onContextCount={() => {}}
    onPersonalSheetSaved={(id) => setSheets(current => id === selectedId ? { ...current, [id]: true } : current)}
  /></StudioLocaleProvider>;
}

createRoot(document.getElementById("root")!).render(<Harness />);
