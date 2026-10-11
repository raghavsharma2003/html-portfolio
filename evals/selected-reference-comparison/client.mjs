import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../../src/studio/livenessApi.ts',import.meta.url),'utf8');
const rid='10000000-0000-4000-8000-000000000001';
const descriptor={statement_set:'selected-voice-comparison/v1',primary_source_id:rid,primary_selection_id:rid,source_sha256:'a'.repeat(64),comparison_snapshot_sha256:'b'.repeat(64),source_label:null,source_created_at:'2026-09-01T00:00:00Z',locales:['en-IN','hi-IN'],available:true,code:''};
const input={locale:'hi-IN',expected_primary_source_id:rid,expected_primary_selection_id:rid,expected_primary_source_sha256:descriptor.source_sha256,expected_comparison_snapshot_sha256:descriptor.comparison_snapshot_sha256,attestations:Object.fromEntries(['live_face_and_voice_processing','compare_face_to_my_id','anti_spoof_and_synthetic_detection','erase_raw_and_provider_session','self_only_private_replica'].map(k=>[k,true])),comparison_attestations:Object.fromEntries(['selected_reference_is_my_voice','compare_this_capture_to_selected_reference','comparison_is_private_verification_only'].map(k=>[k,true]))};
let request,response,calls=0,checks=0;
function load(code){const exports={};new Function('exports','require',ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports,()=>({replicaRequest:async(_token,_path,init)=>{request=init;calls++;return response;}}));return exports;}
const api=load(source),old=load(source.replaceAll('signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : undefined','signal'));
const originalTimeout=AbortSignal.timeout;let timer;
AbortSignal.timeout=ms=>{assert.equal(ms,20000);timer=new AbortController();return timer.signal;};
try{
 for(const op of ['read','issue']){
  const invoke=(a,c)=>op==='read'?a.livenessCaptureReadiness('synthetic',rid,c.signal):a.issueLivenessChallenge('synthetic',rid,input,c.signal);
  response=op==='read'?{readiness:{ready:true,waiting_on:null,code:''},comparison:descriptor,comparison_code:'',challenge:null}:{challenge:{replica_id:rid,challenge_id:rid}};
  let scope=new AbortController();await invoke(api,scope);timer.abort();assert(request.signal.aborted);console.log(`ok ${++checks} - ${op} scope signal retains bounded request deadline`);
  scope=new AbortController();await invoke(api,scope);scope.abort();assert(request.signal.aborted);console.log(`ok ${++checks} - ${op} caller cancellation remains effective`);
  scope=new AbortController();timer=null;await invoke(old,scope);assert.equal(timer,null);assert(!request.signal.aborted);console.log(`ok ${++checks} - ${op} removed-deadline negative loses timer`);
 }
 for(const field of ['expected_primary_source_id','expected_primary_selection_id','expected_primary_source_sha256','expected_comparison_snapshot_sha256']){
  const before=calls;await assert.rejects(()=>api.issueLivenessChallenge('synthetic',rid,{...input,[field]:input[field]+'\n'}));assert.equal(calls,before);console.log(`ok ${++checks} - ${field} trailing newline refuses before transport`);
 }
 response={challenge:{replica_id:rid,challenge_id:rid}};
 await api.issueLivenessChallenge('synthetic',rid,{...input,ignored_secret:'synthetic',attestations:{...input.attestations,extra:true}});
 const body=JSON.parse(request.body);assert(!('ignored_secret' in body));assert.equal(Object.keys(body.attestations).length,5);console.log(`ok ${++checks} - allowlisted request excludes extra fields`);
}finally{AbortSignal.timeout=originalTimeout;}
console.log(`${checks} selected-reference client controls passed; no browser/network/SQL`);
