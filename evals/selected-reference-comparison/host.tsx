import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Journey from '../../src/studio/CloneVerificationJourney';
import OldCapture from 'comparison-old-capture';
import {issueLivenessChallenge,livenessCaptureReadiness} from '../../src/studio/livenessApi';
import {issueLivenessChallenge as oldIssue} from 'comparison-old-api';
import '../../src/studio/design/tokens.css';
import '../../src/studio/studio.css';
import '../../src/studio/clone-verification-journey.css';
const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002';
const SA='20000000-0000-4000-8000-000000000001',SB='20000000-0000-4000-8000-000000000002';
const t='2026-09-01T12:00:00.000Z';
const old=new URLSearchParams(location.search).has('old');
const fixture=window as any;fixture.__comparison={authErrors:0,errors:0,ready:false};
function Host(){
 const [session,setSession]=useState<any>({userId:A,accessToken:'synthetic-initial'});
 const activeSessionRef=useRef(session),accountRevision=useRef(0),selectedIdRef=useRef<string|null>(A);
 const livenessReadRevision=useRef(0),livenessIssueRevision=useRef(0),livenessMounted=useRef(false);
 const [mounted,setMounted]=useState(false),[visible,setVisible]=useState(true),[sourceId,setSourceId]=useState(SA),[receipt,setReceipt]=useState('receipt-1');
 const [selected,setSelected]=useState<any>({replica_id:A,display_name:'Synthetic owner',subject_mode:'self',lifecycle:'enrolling',age_verified:true,identity_verified:false,liveness_verified:false,created_at:t,updated_at:t,policy_version:'fixture'});
 const [challenge,setChallenge]=useState<any>(null);
 useEffect(()=>{livenessMounted.current=true;setMounted(true);fixture.__comparison.ready=true;return()=>{livenessMounted.current=false;};},[]);
 const isCurrentSession=(s:any)=>activeSessionRef.current?.userId===s.userId&&activeSessionRef.current?.accessToken===s.accessToken;
 const refreshForRequest=useCallback(async(s:any)=>{
  if(fixture.__comparison.refresh){const fresh={...s,accessToken:'synthetic-fresh'};activeSessionRef.current=fresh;setSession(fresh);return fresh;}return s;
 },[]);
 const handleApiError=()=>{fixture.__comparison.authErrors++;};
 // Source runner replaces this marker with the exact two StudioApp callbacks.
 /* ACTUAL_STUDIO_CALLBACKS */
 const source:any={source_id:sourceId,replica_id:selected.replica_id,kind:'audio',capture_mode:'upload',mime:'audio/wav',byte_size:720044,state:'ready',contains_third_parties:false,voice_role:'primary',created_at:t,updated_at:receipt,rejection_code:''};
 const consents:any=['capture','transcription','storage'].map(scope=>({consent_id:scope+receipt,replica_id:selected.replica_id,scope,method:'account_attestation',policy_version:'fixture',granted_at:t,expires_at:'2099-01-01T00:00:00Z',revoked_at:null}));
 const props:any={token:session.accessToken,replica:selected,consents,sources:[source],review:{self_test_mode:false,voice_genomes:[],builds:[]},challenge,livenessLoading:false,
 onCheckCaptureReadiness:handleCheckCaptureReadiness,onIssueChallenge:handleIssueChallenge,
 onOpenSourcePermission:()=>{},onResetLegacyClone:async()=>false,onReturnToVoice:()=>{},onContinue:()=>{},onAuthError:()=>{fixture.__comparison.authErrors++;},
 onCreateSourceUpload:async()=>{throw Error('upload forbidden');},onRetryUpload:async()=>{throw Error('upload forbidden');},onFinalizeSourceUpload:async()=>{throw Error('upload forbidden');},onDeleteSource:async()=>{throw Error('erase forbidden');},onSourcesChanged:async()=>{},onIdentityChanged:async()=>{},onVerifiedConsentChanged:async()=>{},onStartFaceSession:async()=>{throw Error('face forbidden');},onPollFaceSession:async()=>{throw Error('face forbidden');},onCancelChallenge:async()=>{throw Error('cancel forbidden');},onCreateLivenessUpload:async()=>{throw Error('upload forbidden');},onFinalizeLiveness:async()=>{throw Error('upload forbidden');}};
 return <><nav aria-label="Synthetic scope controls" data-permission-receipt={receipt}>
 <button onClick={()=>{selectedIdRef.current=B;setSelected({...selected,replica_id:B,display_name:'Synthetic other'});setSourceId(SB);setChallenge(null);}}>Switch replica</button>
 <button onClick={()=>{accountRevision.current++;selectedIdRef.current=B;const next={userId:B,accessToken:'synthetic-other'};activeSessionRef.current=next;setSession(next);setSelected({...selected,replica_id:B});setSourceId(SB);setChallenge(null);}}>Switch account</button>
 <button onClick={()=>{setSourceId(sourceId===SA?SB:SA);setChallenge(null);}}>Switch recording</button>
 <button onClick={()=>{if(fixture.__comparison.deferReceipt)fixture.__comparison.adoptReceipt=()=>setReceipt('receipt-2');else setReceipt('receipt-2');}}>Replace source permission</button>
 <button onClick={()=>{const next={...session,accessToken:'synthetic-fresh'};activeSessionRef.current=next;setSession(next);}}>Refresh token</button>
 <button onClick={()=>{livenessMounted.current=false;setVisible(false);}}>Leave verification</button>
 </nav>{mounted&&visible?(old?<OldCapture consentActive challenge={challenge} loading={false} onCheckReadiness={handleCheckCaptureReadiness} onIssue={(attestations:any)=>oldIssue(session.accessToken,selected.replica_id,attestations)} onStartFace={props.onStartFaceSession} onPollFace={props.onPollFaceSession} onCancel={props.onCancelChallenge} onCreateUpload={props.onCreateLivenessUpload} onRetryUpload={props.onRetryUpload} onFinalize={props.onFinalizeLiveness}/>:<Journey {...props}/>):<p>Outside verification</p>}</>;
}
createRoot(document.getElementById('root')!).render(<Host/>);
