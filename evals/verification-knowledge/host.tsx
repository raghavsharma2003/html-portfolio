import {createRoot} from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/instrument-sans';
import '@fontsource/noto-sans-devanagari/devanagari-600.css';
import '../../src/studio/design/tokens.css';
import '../../src/studio/studio-entry.css';
import '../../src/studio/vyakti-mark.css';
import Current from '../../src/studio/CloneExperience';
import Legacy from 'virtual:journey-before';
import '../../src/studio/studio.css';

const params=new URLSearchParams(location.search),rid='10000000-0000-4000-8000-000000000001',sourceId='20000000-0000-4000-8000-000000000001';
const uploadIntentId='30000000-0000-4000-8000-000000000001',buildIntentId='40000000-0000-4000-8000-000000000001';
const scenario=params.get('case')||'pending',key=`vyakti:experience:voice-saga:v1:${rid}`;
const saga={sourceId,uploadIntentId,buildIntentId,language:'hinglish'};
if(!params.has('reload'))localStorage.setItem(key,JSON.stringify(saga));
sessionStorage.removeItem('vyakti:experience:reveal');
const replica={replica_id:rid,display_name:'Synthetic teacher',subject_mode:'self',lifecycle:'enrolling',policy_version:'replica-self-v1',age_verified:scenario==='unavailable',identity_verified:false,liveness_verified:false,created_at:'2026-09-01T00:00:00Z',updated_at:'2026-09-01T00:00:00Z'};
// Synthetic stored state only. No identity, voice, runtime or source authority is created.
const source={source_id:sourceId,replica_id:rid,kind:'audio',capture_mode:'upload',mime:'audio/wav',byte_size:720044,state:scenario==='pending'?'processing':'ready',voice_role:'supporting',contains_third_parties:false,rejection_code:'',upload_intent_id:uploadIntentId,created_at:'2026-09-01T00:00:00Z',updated_at:'2026-09-01T00:00:00Z'};
const consents=['capture','transcription','storage'].map((scope,i)=>({consent_id:`50000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,replica_id:rid,scope,method:'account_attestation',policy_version:'replica-self-v1',granted_at:'2026-09-01T00:00:00Z',expires_at:'2099-09-01T00:00:00Z',revoked_at:null}));
const review={replica_id:rid,self_test_mode:false,sources:[],jobs:[],attempts:[],artifacts:[],evidence:[],builds:[],voice_genomes:[],voice_genome_readiness:{ready:false,blockers:[],reviewed_real_evidence:0,embedding_families:0,voice_measurements:0,quality_measurements:0,speaker_segments:0}};
const probe=(window as any).journeyProbe={builds:[] as unknown[],mutations:[] as string[],readiness:0,authErrors:[] as string[]};
const no=()=>{},read=async()=>{},forbid=async()=>{probe.mutations.push('unexpected');throw Error('unexpected_mutation');};
const Component=params.has('old')?Legacy:Current;
const props={identity:'synthetic-owner@example.test',accessToken:'fixture-token',replicas:[replica],selected:replica,creatingNew:false,creating:false,revoking:false,consents,sources:[source],runtimeStatus:null,activityView:{replica_id:rid,generated_at:'2026-09-01',jobs:[],lanes:[],in_flight:false,next_poll_ms:null},wizardInput:{stopped:false,sourceConsent:true,sourceCount:1,contextItemCount:0,identityVerified:false,livenessVerified:false,sheetPersisted:false,mode:'generic',runtime:null,connectedChannels:null,platformWork:null},review,reviewLoading:false,challenge:null,livenessLoading:false,notice:'',error:null,onDismissNotice:no,onDismissError:no,onSignOut:no,onBeginClone:forbid,onGrantConsent:forbid,onSelectReplica:forbid,onStartNew:no,onRevoke:forbid,onCreateUpload:forbid,onRetryUpload:forbid,onFinalizeUpload:forbid,onDeleteSource:forbid,onRefreshEnrollment:read,onRefreshReview:read,onIssueChallenge:forbid,onStartFaceSession:forbid,onPollFaceSession:forbid,onCancelChallenge:forbid,onCreateLivenessUpload:forbid,onFinalizeLiveness:forbid,onVerifiedConsentChanged:read,onActivityView:no,onActivityAct:no,onAuthError:(e:unknown)=>probe.authErrors.push(String(e)),onContextCount:no,
 onRequestVoiceBuild:async(input:unknown)=>{probe.builds.push(input);return{intent_id:buildIntentId,replica_id:rid,candidate_source_id:sourceId,state:'awaiting_verification',build_id:null,build_state:null,target_version:null,blockers:[],last_error_code:'',promoted_at:null,next_check_at:'2099-01-01T00:00:00Z',created_at:'2026-09-01T00:00:00Z',updated_at:'2026-09-01T00:00:00Z',replayed:true};},
 onCheckCaptureReadiness:async()=>{probe.readiness++;return{challenge:null,readiness:{ready:false,waiting_on:'us',code:'liveness_verifier_unavailable'}};}};
createRoot(document.getElementById('root')!).render(<Component {...props as any}/>);
