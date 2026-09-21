import { createRoot } from "react-dom/client";
import { useState } from "react";
import Current from "../../src/studio/CloneExperience";
import Legacy from "virtual:legacy-experience";
import type { ConsentReceipt, Replica, ReplicaReview, ReplicaSource, VoiceBuildIntent } from "../../src/studio/types";
import type { WizardInput } from "../../src/studio/wizardModel";
import type { ActivityView } from "../../src/studio/activityApi";
const params = new URLSearchParams(location.search);
const scenario = params.get("case") || "changed";
const CloneExperience = params.has("legacy") ? Legacy : Current;
const replicaId = "10000000-0000-4000-8000-000000000001";
const oldSourceId = "20000000-0000-4000-8000-000000000002";
const candidateSourceId = "30000000-0000-4000-8000-000000000003";
const uploadIntentId = "40000000-0000-4000-8000-000000000004";
const buildIntentId = "50000000-0000-4000-8000-000000000005";
const sagaKey = `vyakti:experience:voice-saga:v1:${replicaId}`;


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


const seed = {uploadIntentId,buildIntentId,sourceId:candidateSourceId,language:"hinglish"};
if (!params.has("reload")) localStorage.setItem(sagaKey,JSON.stringify(seed));
sessionStorage.removeItem("vyakti:experience:reveal");
const probe = window.recoveryProbe = {calls:[] as any[],reads:0,resolve:null as null|(()=>void),change:null as any,unmount:()=>root.unmount()};
function Harness(){
 const [token,setToken]=useState("offline");
 const [rows,setRows]=useState([oldPrimary,candidate("ready")]);
 const [grants,setGrants]=useState(consents);
 probe.change=(kind:string)=>{if(kind==="scope")setToken("changed");if(kind==="deleted")setRows([oldPrimary]);if(kind==="consent")setGrants([]);};
 async function read(){
  probe.reads++;
  if(scenario.startsWith("pending"))await new Promise<void>(resolve=>{probe.resolve=resolve;});
  if(scenario==="read-failed")throw new Error("Fresh recording check unavailable.");
  return {replica,sources:scenario==="foreign"?[{...candidate("ready"),replica_id:"foreign"}]:scenario==="deleted"?[oldPrimary]:scenario==="rejected"?[candidate("rejected")]:scenario==="third-party"?[{...candidate("ready"),contains_third_parties:true}]:[oldPrimary,candidate("ready")],consents:scenario==="consent"?[]:consents};
 }
 // Keep the actual parent callback stable while ordinary request results render.
 const [readCallback]=useState(()=>read);
 async function request(input:{candidateSourceId:string;buildIntentId:string}){
  probe.calls.push({...input,persisted:JSON.parse(localStorage.getItem(sagaKey)||"null")});
  if(input.buildIntentId!==buildIntentId && scenario==="ambiguous")throw new Error("connection interrupted");
  return {intent_id:input.buildIntentId,replica_id:replicaId,candidate_source_id:input.candidateSourceId,state:input.buildIntentId===buildIntentId?"failed":"queued",build_id:null,build_state:null,target_version:null,blockers:[],last_error_code:scenario==="missing"?"primary_selection_snapshot_missing":scenario==="generic"?"voice_quality_failed":"primary_voice_selection_changed",promoted_at:null,next_check_at:"2027-01-01",created_at:"2026-09-01",updated_at:"2026-09-01",replayed:false} as VoiceBuildIntent;
 }
 return <CloneExperience identity="owner@example.test" accessToken={token} replicas={[replica]} selected={replica}
 creatingNew={false} creating={false} revoking={false} consents={grants} sources={rows} runtimeStatus={null} activityView={emptyActivity} wizardInput={wizardInput} review={review} reviewLoading={false} challenge={null} livenessLoading={false} notice="" error={null}
 onDismissNotice={()=>{}} onDismissError={()=>{}} onSignOut={()=>{}} onBeginClone={async()=>replica} onGrantConsent={async()=>{}} onSelectReplica={async()=>{}} onStartNew={()=>{}} onRevoke={async()=>false}
 onCreateUpload={async()=>{throw new Error("unexpected upload")}} onRetryUpload={async()=>{throw new Error("unexpected retry")}} onFinalizeUpload={async()=>candidate("ready")}
 onRequestVoiceBuild={request} onReadVoiceReissue={scenario==="unavailable"?undefined:readCallback} onDeleteSource={async()=>"complete"} onRefreshEnrollment={async()=>{}} onRefreshReview={async()=>{}}
 onCheckCaptureReadiness={async()=>{throw new Error("unused")}} onIssueChallenge={async()=>{throw new Error("unused")}} onStartFaceSession={async()=>{throw new Error("unused")}} onPollFaceSession={async()=>{throw new Error("unused")}} onCancelChallenge={async()=>{throw new Error("unused")}} onCreateLivenessUpload={async()=>{throw new Error("unused")}} onFinalizeLiveness={async()=>{throw new Error("unused")}} onVerifiedConsentChanged={async()=>{}} onActivityView={()=>{}} onActivityAct={()=>{}} onAuthError={()=>{}} onContextCount={()=>{}} />;
}
const root=createRoot(document.getElementById("root")!);root.render(<Harness/>);
