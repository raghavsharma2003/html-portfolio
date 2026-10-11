// Execute actual component/API callbacks, without browser or provider work.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const component=readFileSync(new URL('../src/creatorStudio/VoiceIdentityChallenge.tsx',import.meta.url),'utf8');
const api=readFileSync(new URL('../src/creatorStudio/voiceIdentityApi.ts',import.meta.url),'utf8');
function functions(source,names,env){
  const tree=ts.createSourceFile('test.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),found=[];
  const visit=node=>{if(ts.isFunctionDeclaration(node)&&names.includes(node.name?.text))found.push(node.getText(tree));ts.forEachChild(node,visit);};visit(tree);
  assert.equal(found.length,names.length,'actual callback declarations located');
  const compiled=ts.transpile(found.join('\n').replaceAll('export async function','async function'),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022});
  return new Function(...Object.keys(env),compiled+`;return {${names.join(',')}};`)(...Object.values(env));
}
let checks=0;const check=async(name,fn)=>{await fn();console.log('PASS '+name);checks++;};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{resolve,reject,promise};};
function world(){
  const challenge={challenge_id:'challenge-a',replica_id:'replica-a',state:'issued',expires_at:new Date(Date.now()+600000).toISOString(),captured_source_id:null,transcript_source_id:null};
  const recording={video:{type:'video/webm',size:100},wav:{type:'audio/wav',size:80},url:'blob:synthetic'};
  const calls={create:[],put:[],finalize:[],errors:[],refresh:0,cancel:0},env={challenge,recording,issued:true,
    challengeRef:{current:challenge},consentRef:{current:true},uploadAttemptRef:{current:null},uploadRunningRef:{current:false},
    setStage:()=>{},setProgress:()=>{},setBusyLabel:()=>{},setRecording:()=>{},setError:error=>calls.errors.push(error),
    onRefresh:()=>calls.refresh++,sha256File:async()=> 'a'.repeat(64),
    putSignedUpload:async(file,upload)=>calls.put.push(upload.source),
    onCreateUpload:async input=>{
      calls.create.push(input.role);const sourceId='source-'+input.role;
      challenge[input.role==='capture'?'captured_source_id':'transcript_source_id']=sourceId;
      return{challenge:{...challenge},source:{source_id:sourceId,replica_id:challenge.replica_id},upload:{source:sourceId}};
    },
    onFinalize:async(cid,sid)=>{calls.finalize.push(sid);return{...challenge,state:sid==='source-transcript'?'captured':'issued'};},
    cancel:async()=>calls.cancel++,stopTracks:()=>{},URL:{revokeObjectURL:()=>{}},
  };
  return{env,calls,build:()=>functions(component,['currentAttempt','sendOne','upload','clearRecording','retake'],env)};
}
for(const failedRole of ['capture','transcript'])await check(`retry after ${failedRole} finalize failure never repeats completed upload steps`,async()=>{
  const w=world();let failed=false;const original=w.env.onFinalize;
  w.env.onFinalize=async(cid,sid)=>{
    if(sid==='source-'+failedRole&&!failed){failed=true;w.calls.finalize.push(sid);throw Object.assign(new Error('busy'),{status:409,data:{error:'voice_challenge_finalize_busy'}});}
    return original(cid,sid);
  };
  const callbacks=w.build();await callbacks.upload();
  const attempt=w.env.uploadAttemptRef.current;assert(attempt);assert.equal(attempt.slots[failedRole].uploaded,true);assert.equal(attempt.slots[failedRole].finalized,false);
  await callbacks.upload();
  assert.deepEqual(w.calls.create,['capture','transcript']);assert.deepEqual(w.calls.put,['source-capture','source-transcript']);
  assert.equal(w.calls.finalize.filter(s=>s==='source-'+failedRole).length,2);assert.equal(w.env.uploadAttemptRef.current,null);
});
await check('definitive removal blocks retry and offers cancellation rather than recreating sources',async()=>{
  const w=world();w.env.onFinalize=async()=>{throw Object.assign(new Error('removed'),{status:404,data:{error:'pending_challenge_source_not_found'}});};
  const cb=w.build();await cb.upload();assert.equal(w.env.uploadAttemptRef.current.blocked,true);
  await cb.upload();assert.deepEqual(w.calls.create,['capture']);assert.equal(w.calls.put.length,1);
  cb.retake();assert.equal(w.calls.cancel,1);
});
await check('uncertain authorization stops instead of creating an unbound duplicate on Retry',async()=>{
  const w=world();w.env.onCreateUpload=async()=>{w.calls.create.push('capture');throw Error('response lost');};
  const cb=w.build();await cb.upload();assert.equal(w.env.uploadAttemptRef.current.blocked,true);
  await cb.upload();assert.equal(w.calls.create.length,1);assert.equal(w.calls.put.length,0);
});
await check('capture replacement invalidates a late finalize callback and the second upload',async()=>{
  const w=world(),pending=deferred();w.env.onFinalize=()=>pending.promise;const cb=w.build();
  const work=cb.upload();for(let i=0;i<8;i++)await Promise.resolve();
  assert(w.env.uploadAttemptRef.current?.slots.capture?.uploaded);
  cb.clearRecording();w.env.challengeRef.current={...w.env.challenge,challenge_id:'different'};
  pending.resolve({...w.env.challenge});await work;
  assert.deepEqual(w.calls.create,['capture']);assert.equal(w.calls.put.length,1);assert.equal(w.calls.errors.at(-1),'');
});
await check('component scope cleanup discards upload progress across challenge and replica changes',()=>{
  assert.match(component,/return \(\) => \{ uploadAttemptRef\.current = null; \};\s*\}, \[challenge\?\.replica_id, challenge\?\.challenge_id\]\)/);
  assert(component.includes('uploadAttemptRef.current !== attempt'));
});
function apiWorld({state='quarantined',changed=false,expired=false,status}={}){
  const original=Object.assign(new Error('lost finalization response'),status?{status}:{}),calls=[];
  const challenge={challenge_id:changed?'replacement':'challenge-a',replica_id:'replica-a',state:'issued',
    expires_at:new Date(Date.now()+(expired?-1000:600000)).toISOString(),captured_source_id:'source-a',transcript_source_id:null};
  const source={source_id:'source-a',replica_id:'replica-a',capture_mode:'identity_challenge',state};
  const env={replicaRequest:async(token,path,options)=>{
    const body=JSON.parse(options.body);calls.push(body.op);assert.equal(token,'private-token');
    if(body.op==='finalize')throw original;return{challenge};
  },listSources:async(token,rid)=>{assert.equal(token,'private-token');assert.equal(rid,'replica-a');calls.push('source-list');return[source];},ENDPOINT:'/api/replica-voice-identity'};
  return{...functions(api,['voiceIdentityStatus','finalizeVoiceIdentityUpload'],env),original,calls,challenge,source};
}
await check('uncertain finalized response uses one exact readback and never repeats a write',async()=>{
  for(const status of [undefined,404,503]){
    const w=apiWorld({status}),result=await w.finalizeVoiceIdentityUpload('private-token','replica-a','challenge-a','source-a');
    assert.equal(result.source,w.source);assert.equal(result.challenge,w.challenge);assert.deepEqual(w.calls,['finalize','status','source-list']);
  }
});
await check('readback does not infer completion from replacement, deletion, pending state or expiry',async()=>{
  for(const options of [{changed:true},{state:'deleting'},{state:'pending_upload'},{expired:true}]){
    const w=apiWorld(options);await assert.rejects(()=>w.finalizeVoiceIdentityUpload('private-token','replica-a','challenge-a','source-a'),error=>error===w.original);
  }
  const busy=apiWorld({status:409});await assert.rejects(()=>busy.finalizeVoiceIdentityUpload('private-token','replica-a','challenge-a','source-a'));
  assert.deepEqual(busy.calls,['finalize']);
});
console.log(`${checks} actual voice upload callback groups passed; no browser, storage or identity acceptance proof.`);
