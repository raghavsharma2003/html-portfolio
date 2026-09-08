import "@fontsource-variable/geist";
import "@fontsource-variable/instrument-sans";
import "../../src/studio/clone-experience.css";
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import Journey from '../../src/studio/CloneVerificationJourney';
import OldJourney from 'comparison-reference-old-journey';
import '../../src/studio/design/tokens.css';
import '../../src/studio/studio.css';
import '../../src/studio/clone-verification-journey.css';
const ids=/* SYNTHETIC_IDS */{} as Record<string,string>;
const fixture=window as any;fixture.__reference={authErrors:0,ready:true};
const old=new URLSearchParams(location.search).has('old');
function Host(){
 const [rid,setRid]=useState(ids['1']),[owner,setOwner]=useState(ids['2']),[token,setToken]=useState('synthetic-owner');
 const [source,setSource]=useState(ids['3']),[revision,setRevision]=useState(1),[visible,setVisible]=useState(true),[stopped,setStopped]=useState(false);
 const t='2026-09-01T12:00:00.000Z';
 const props:any={token,ownerUserId:owner,replica:{replica_id:rid,display_name:'Synthetic owner',subject_mode:'self',lifecycle:stopped?'revoked':'enrolling',age_verified:true,identity_verified:false,liveness_verified:false,policy_version:'fixture',created_at:t,updated_at:t},
 consents:['capture','storage','transcription'].map(scope=>({consent_id:scope+revision,replica_id:rid,scope,granted_at:t,expires_at:'2099-01-01T00:00:00Z',revoked_at:null})),
 sources:[{source_id:source,replica_id:rid,kind:'audio',capture_mode:'upload',state:'ready',voice_role:'primary',mime:'audio/wav',byte_size:32044,contains_third_parties:false,created_at:t,updated_at:String(revision)}],review:{self_test_mode:false,voice_genomes:[],builds:[]},challenge:null,livenessLoading:false,
 onCheckCaptureReadiness:async()=>({challenge:null,readiness:{ready:false,waiting_on:'us',code:'liveness_verifier_unavailable'},comparison:null,comparison_code:'selected_reference_not_available'}),
 onAuthError:()=>{fixture.__reference.authErrors++;},onOpenSourcePermission:()=>{},onResetLegacyClone:async()=>false,onReturnToVoice:()=>{},onContinue:()=>{},onSourcesChanged:async()=>{},onIdentityChanged:async()=>{},onVerifiedConsentChanged:async()=>{}};
 const View=old?OldJourney:Journey;
 return <><nav aria-label="Synthetic scope controls"><button onClick={()=>{setRid(ids['11']);setSource(ids['13']);}}>Switch replica</button><button onClick={()=>{setOwner(ids['12']);setToken('synthetic-other');setRid(ids['11']);setSource(ids['13']);}}>Switch account</button><button onClick={()=>setToken('synthetic-fresh')}>Refresh token</button><button onClick={()=>{setSource(ids['13']);setRevision(r=>r+1);}}>Replace recording</button><button onClick={()=>setRevision(r=>r+1)}>Replace permission</button><button onClick={()=>setVisible(false)}>Leave verification</button><button onClick={()=>setStopped(true)}>Stop clone</button></nav>{visible?<View {...props}/>:<p>Outside verification</p>}</>;
}
createRoot(document.getElementById('root')!).render(<Host/>);
