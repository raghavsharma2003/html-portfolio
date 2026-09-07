import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import type {LivenessChallenge} from '../../src/studio/types';
import type {LivenessCaptureReadiness} from '../../src/studio/livenessApi';

const params = new URLSearchParams(location.search);
// The test server supplies the actual component source, with bounded mutation
// variants solely for negative controls. No production source is rewritten.
const {default: Capture} = await import(/* @vite-ignore */ `/@id/virtual:modern-capture-${params.get('variant') || 'current'}`);
let mode = params.get('mode') || 'blocked';
const calls = {readiness:0,media:0,constructed:0,start:0,stopped:0,issue:0,face:0,poll:0,cancel:0,upload:0};
const challenge: LivenessChallenge = {
 challenge_id:'10000000-0000-4000-8000-000000000001',replica_id:'20000000-0000-4000-8000-000000000002',
 phrase:'Synthetic fixture code 421 682',state:'issued',attempt:1,source_id:null,failure_code:'',
 issued_at:new Date().toISOString(),expires_at:new Date(Date.now()+300000).toISOString(),updated_at:new Date().toISOString(),
 face_session_state:(params.get('face') || 'passed_deleted') as LivenessChallenge['face_session_state'],
};
let fresh = {...challenge};
let deferredMedia = false;
let releaseMedia: (()=>void) | null = null;
let releaseRead: (()=>void) | null = null;
function fixtureStream() {
 const stream = new MediaStream();
 const tracks = [0,1].map(()=>({stop(){calls.stopped++;}} as MediaStreamTrack));
 stream.getTracks=()=>tracks;return stream;
}
Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{
 calls.media++;
 if(deferredMedia)return new Promise<MediaStream>(resolve=>{releaseMedia=()=>resolve(fixtureStream());});
 return fixtureStream();
}}});
class Recorder {
 constructor(){calls.constructed++;}
 static isTypeSupported(){return true;} state='inactive';ondataavailable=null;onstop=null;onerror=null;
 start(){calls.start++;this.state='recording';} stop(){this.state='inactive';}
}
Object.defineProperty(window,'MediaRecorder',{configurable:true,value:Recorder});
const onCheckReadiness=async():Promise<LivenessCaptureReadiness>=>{
 calls.readiness++;
 if(mode==='pending')return new Promise(()=>{});
 if(mode==='deferred')return new Promise(resolve=>{const snapshot={...fresh};releaseRead=()=>resolve({challenge:snapshot,readiness:{ready:true,waiting_on:null,code:''}});});
 if(mode==='error')throw Error('Fixture readiness read failed');
 return {challenge:fresh,readiness:{ready:mode==='ready',waiting_on:mode==='ready'?null:'us',code:mode==='ready'?'':'liveness_verifier_unavailable'}};
};
let localChallenge: LivenessChallenge | null = params.has('empty')?null:challenge;
let consentActive = true;
let readinessCallback = onCheckReadiness;
const root = createRoot(document.getElementById('root')!);
function render(){root.render(<Capture consentActive={consentActive} challenge={localChallenge} loading={false}
 onCheckReadiness={readinessCallback} onIssue={async()=>{calls.issue++;return challenge;}}
 onStartFace={async()=>{calls.face++;return {challenge,quick_link_url:'https://liveness.face.azure.com/fixture'};}}
 onPollFace={async()=>{calls.poll++;return challenge;}}
 onCancel={async()=>{calls.cancel++;return {challenge,erasure:'not_required'};}}
 onCreateUpload={async()=>{calls.upload++;throw Error('No uploads in component probe');}}
 onRetryUpload={async()=>{throw Error('No uploads in component probe');}} onFinalize={async()=>challenge}/>);}

Object.assign(window,{captureProbe:{calls,
 setMode(value:string){mode=value;},setFresh(value:Partial<LivenessChallenge>){fresh={...fresh,...value};},
 deferMedia(){deferredMedia=true;},releaseMedia(){if(!releaseMedia)throw Error('No pending permission');releaseMedia();},
 releaseRead(){if(!releaseRead)throw Error('No pending readiness');releaseRead();},
 setLocal(value:Partial<LivenessChallenge>){localChallenge={...challenge,...value};flushSync(render);},
 revokeConsent(){consentActive=false;flushSync(render);},
 changeCallback(){readinessCallback=()=>onCheckReadiness();flushSync(render);},
 unmount(){root.unmount();},
}});
render();
